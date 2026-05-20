const fs = require('fs')
const path = require('path')
const MaterialService = require('./MaterialService')
const MixFormatConverter = require('./MixFormatConverter')

const MODELS_DIR = path.join(__dirname, '..', '..', '..', 'resources', 'models')

const MODEL_FILES = {
  strength28d: 'strength28d.json',
  slump: 'slump.json',
  density: 'density.json'
}

const RESULT_UNITS = {
  strength28d: 'MPa',
  slump: 'mm',
  density: 'kg/m³'
}

class XGBoostPredictionService {
  constructor() {
    this._models = null
    this._featureConfig = null
    this._loading = null
  }

  async _loadModels() {
    if (this._models) return this._models
    if (this._loading) return this._loading

    this._loading = this._doLoad()
    try {
      return await this._loading
    } finally {
      this._loading = null
    }
  }

  async _doLoad() {
    const models = {}

    let featureConfigPath
    try {
      featureConfigPath = path.join(MODELS_DIR, 'feature_config.json')
      const raw = fs.readFileSync(featureConfigPath, 'utf-8')
      this._featureConfig = JSON.parse(raw)
    } catch (err) {
      console.error('加载特征配置失败:', err.message)
      this._featureConfig = null
    }

    for (const [target, filename] of Object.entries(MODEL_FILES)) {
      try {
        const filePath = path.join(MODELS_DIR, filename)
        const raw = fs.readFileSync(filePath, 'utf-8')
        const modelData = JSON.parse(raw)

        if (
          modelData.model_version === '0.0-placeholder' ||
          !modelData.trees ||
          modelData.trees.length === 0
        ) {
          console.log(`跳过占位模型: ${target} (${filename})`)
          continue
        }

        models[target] = modelData
      } catch (err) {
        console.error(`加载模型 ${filename} 失败:`, err.message)
      }
    }

    // Validate models: non-leaf nodes must have split_feature
    for (const [target, model] of Object.entries(models)) {
      let brokenCount = 0
      let totalNonLeaf = 0
      for (const tree of model.trees) {
        for (const node of tree) {
          if (node.leaf === undefined) {
            totalNonLeaf++
            if (node.split_feature === undefined) {
              brokenCount++
            }
          }
        }
      }
      if (totalNonLeaf > 0 && brokenCount > 0) {
        console.error(`模型 ${target} 校验失败: ${brokenCount}/${totalNonLeaf} 个非叶节点缺少 split_feature，模型已损坏`)
        delete models[target]
      }
    }

    this._models = models
    return this._models
  }

  async predict(inputParams) {
    try {
      const models = await this._loadModels()

      if (!models || Object.keys(models).length === 0) {
        return {
          success: false,
          error: '预测模型未加载，请检查模型文件是否存在且非占位版本'
        }
      }

      const validation = this._validateInputParams(inputParams)
      if (!validation.success) return validation

      const { features, warnings: featureWarnings } = await this._buildFeatureVector(inputParams)

      const predictions = {}
      const allWarnings = [...featureWarnings]

      for (const [target, model] of Object.entries(models)) {
        const { value, warnings: predictWarnings } = this._predictOne(model, features)
        const { confidence, warnings: rangeWarnings } = this._checkFeatureRange(model, features)
        const targetWarnings = [...predictWarnings, ...rangeWarnings]

        predictions[target] = {
          value: Math.round(value * 100) / 100,
          unit: RESULT_UNITS[target] || '',
          confidence,
          warnings: targetWarnings
        }

        allWarnings.push(...targetWarnings)
      }

      const firstModel = Object.values(models)[0]
      const modelInfo = {
        version: firstModel.model_version || 'unknown',
        trainingSamples: firstModel.training_info?.samples || 0,
        trainingDate: firstModel.training_info?.date || 'unknown'
      }

      return {
        success: true,
        predictions,
        warnings: [...new Set(allWarnings)],
        modelInfo
      }
    } catch (err) {
      console.error('预测失败:', err)
      return {
        success: false,
        error: `预测过程出错: ${err.message}`
      }
    }
  }

  _predictOne(model, features) {
    const { trees, base_score } = model

    let sum = base_score || 0

    for (const tree of trees) {
      const leafValue = this._traverseTree(tree, 0, features)
      // export_model.py uses XGBoost's prediction leaf values, which already include learning_rate.
      sum += leafValue
    }

    return {
      value: sum,
      warnings: []
    }
  }

  _validateInputParams(inputParams) {
    if (!inputParams || typeof inputParams !== 'object') {
      return {
        success: false,
        error: '性能预测参数不能为空',
        missingParams: ['inputParams']
      }
    }

    const getNumber = (key) => {
      const value = inputParams[key]
      if (value === undefined || value === null || value === '') return null
      const num = Number(value)
      return Number.isFinite(num) ? num : null
    }

    const isPositive = (key) => {
      const num = getNumber(key)
      return num !== null && num > 0
    }

    const binderTotal = [
      'cementAmount',
      'flyAshAmount',
      'slagAmount',
      'lithiumSlagAmount',
      'compositePowderAmount'
    ].reduce((sum, key) => sum + Math.max(0, getNumber(key) ?? 0), 0)

    const hasWaterBinderRatio = isPositive('waterBinderRatio')
    const hasMassWaterBinderRatio = isPositive('waterAmount') && binderTotal > 0

    const missingParams = []
    if (!isPositive('cementAmount')) missingParams.push('cementAmount')
    if (!hasWaterBinderRatio && !hasMassWaterBinderRatio) {
      missingParams.push('waterBinderRatio 或 waterAmount+胶凝材料用量')
    }

    if (missingParams.length > 0) {
      return {
        success: false,
        error: `缺少性能预测必填参数: ${missingParams.join(', ')}`,
        missingParams,
        hint: '请至少提供水泥用量，以及水胶比；如果使用质量格式，请提供用水量和胶凝材料总量。'
      }
    }

    const waterBinderRatio = getNumber('waterBinderRatio')
    if (waterBinderRatio !== null && (waterBinderRatio <= 0 || waterBinderRatio > 1.5)) {
      return {
        success: false,
        error: `水胶比 ${waterBinderRatio} 不在合理范围内`,
        invalidParams: ['waterBinderRatio']
      }
    }

    return { success: true }
  }

  _traverseTree(tree, nodeIndex, features) {
    const node = tree[nodeIndex]

    if (node.leaf !== undefined) {
      return node.leaf
    }

    const featureValue = features[node.split_feature]

    let nextIndex
    if (featureValue === undefined || featureValue === null || featureValue === -1) {
      nextIndex = node.missing
    } else if (featureValue <= node.split_condition) {
      nextIndex = node.left
    } else {
      nextIndex = node.right
    }

    if (nextIndex === undefined || nextIndex === null) {
      return 0
    }

    return this._traverseTree(tree, nextIndex, features)
  }

  _checkFeatureRange(model, features) {
    const { feature_stats, feature_names } = model

    if (!feature_stats || Object.keys(feature_stats).length === 0) {
      return { confidence: 'medium', warnings: [] }
    }

    const usableStatsCount = feature_names.filter(name => {
      const stats = feature_stats[name]
      return stats && Number.isFinite(stats.min) && Number.isFinite(stats.max)
    }).length

    if (usableStatsCount === 0) {
      return {
        confidence: 'medium',
        warnings: [`${model.target || '模型'}缺少训练特征范围，无法判断输入是否超出训练数据`]
      }
    }

    const warnings = []
    const featureConfig = this._featureConfig

    for (let i = 0; i < feature_names.length; i++) {
      const featureName = feature_names[i]
      const value = features[i]

      if (value === undefined || value === null || value === -1) continue

      const stats = feature_stats[featureName]
      if (!stats) continue

      if (value < stats.min || value > stats.max) {
        let label = featureName
        if (featureConfig && featureConfig.features) {
          const cfg = featureConfig.features.find(f => f.name === featureName)
          if (cfg) label = cfg.label || featureName
        }

        warnings.push(
          `${label}${value}超出训练数据范围[${stats.min}, ${stats.max}]`
        )
      }
    }

    let confidence = 'high'
    if (warnings.length >= 3) confidence = 'low'
    else if (warnings.length >= 1) confidence = 'medium'

    const rSquared = Number(model.training_info?.r_squared)
    if (Number.isFinite(rSquared)) {
      if (rSquared < 0.2) {
        warnings.push(`${model.target || '模型'}模型R²=${rSquared}，预测解释能力较弱，仅供参考`)
        confidence = 'low'
      } else if (rSquared < 0.5 && confidence === 'high') {
        warnings.push(`${model.target || '模型'}模型R²=${rSquared}，预测置信度下调为中等`)
        confidence = 'medium'
      }
    }

    return { confidence, warnings }
  }

  async _buildFeatureVector(inputParams) {
    const features = new Array(34).fill(-1)
    const warnings = []

    let params = { ...inputParams }

    if (MixFormatConverter.hasMassInputs(params)) {
      const converted = MixFormatConverter.massToPercent(params)
      params = {
        ...params,
        ...converted
      }
    }

    const {
      waterBinderRatio,
      cementAmount,
      flyAshDosage,
      slagDosage,
      lithiumSlagDosage,
      compositePowderDosage,
      sandRatio,
      superplasticizerDosage,
      has_fly_ash,
      has_slag,
      has_lithium_slag,
      has_composite_powder,
      has_superplasticizer,
      flyAshId,
      slagId,
      lithiumSlagId,
      compositePowderId,
      cementId,
      sandId,
      stoneId,
      superplasticizerId,
      temperature,
      humidity,
      curingAge
    } = params

    if (waterBinderRatio === undefined || waterBinderRatio === null) {
      warnings.push('水胶比缺失，使用默认值0.45')
    }
    if (sandRatio === undefined || sandRatio === null) {
      warnings.push('砂率缺失，使用默认值38%')
    }

    features[0] = waterBinderRatio ?? 0.45
    features[1] = cementAmount ?? 0
    features[2] = flyAshDosage ?? 0
    features[3] = slagDosage ?? 0
    features[4] = lithiumSlagDosage ?? 0
    features[5] = compositePowderDosage ?? 0
    features[6] = sandRatio ?? 38
    features[7] = superplasticizerDosage ?? 0

    features[8] = has_fly_ash ?? (flyAshDosage > 0 || (flyAshId && flyAshId > 0) ? 1 : 0)
    features[9] = has_slag ?? (slagDosage > 0 || (slagId && slagId > 0) ? 1 : 0)
    features[10] = has_lithium_slag ?? (lithiumSlagDosage > 0 || (lithiumSlagId && lithiumSlagId > 0) ? 1 : 0)
    features[11] = has_composite_powder ?? (compositePowderDosage > 0 || (compositePowderId && compositePowderId > 0) ? 1 : 0)
    features[12] = has_superplasticizer ?? (superplasticizerDosage > 0 || (superplasticizerId && superplasticizerId > 0) ? 1 : 0)

    try {
      const allMaterials = await MaterialService.getAllMaterials()
      const matById = new Map()
      for (const m of allMaterials) {
        matById.set(Number(m.id), m)
      }

      const findField = (id, type, field, label) => {
        if (!id) return -1
        const numericId = Number(id)
        const mat = matById.get(numericId)
        if (!mat) {
          warnings.push(`${label}材料ID=${id}不存在，按缺失值处理`)
          return -1
        }
        if (mat.type !== type) {
          warnings.push(`${label}材料ID=${id}类型为${mat.type || '未知'}，不是${type}，按缺失值处理`)
          return -1
        }
        const val = mat[field]
        if (val === undefined || val === null) {
          warnings.push(`${mat.name || `${type}ID=${id}`}缺少${label}，按缺失值处理`)
          return -1
        }
        return val
      }

      const warnMissingUsedMaterial = (used, id, label) => {
        if (used && !id) warnings.push(`${label}已使用但未提供材料ID，对应材料属性按缺失值处理`)
      }

      warnMissingUsedMaterial(features[8] === 1, flyAshId, '粉煤灰')
      warnMissingUsedMaterial(features[9] === 1, slagId, '矿渣粉')
      warnMissingUsedMaterial(features[10] === 1, lithiumSlagId, '锂渣')
      warnMissingUsedMaterial(features[11] === 1, compositePowderId, '复合粉')
      warnMissingUsedMaterial(features[12] === 1, superplasticizerId, '外加剂')

      features[13] = findField(cementId, '水泥', 'compressiveStrength28d', '水泥28d抗压强度')
      features[14] = findField(cementId, '水泥', 'standardConsistency', '水泥标准稠度')
      features[15] = findField(flyAshId, '粉煤灰', 'activityIndex28d', '粉煤灰28d活性指数')
      features[16] = findField(flyAshId, '粉煤灰', 'waterDemandRatio', '粉煤灰需水比')
      features[17] = findField(slagId, '矿渣粉', 'activityIndex28d', '矿渣粉28d活性指数')
      features[18] = findField(slagId, '矿渣粉', 'fluidityRatio', '矿渣粉流动度比')
      features[19] = findField(lithiumSlagId, '锂渣', 'activityIndex28d', '锂渣28d活性指数')
      features[20] = findField(lithiumSlagId, '锂渣', 'waterDemandRatio', '锂渣需水比')
      features[21] = findField(compositePowderId, '复合粉', 'activityIndex28d', '复合粉28d活性指数')
      features[22] = findField(compositePowderId, '复合粉', 'waterDemandRatio', '复合粉需水比')
      features[23] = findField(sandId, '细骨料', 'finenessModulus', '细骨料细度模数')
      features[24] = findField(sandId, '细骨料', 'mbValue', '细骨料MB值')
      features[25] = findField(sandId, '细骨料', 'mudContent', '细骨料含泥量')
      features[26] = findField(stoneId, '粗骨料', 'crushingValue', '粗骨料压碎值')
      features[27] = findField(stoneId, '粗骨料', 'needleFlakeContent', '粗骨料针片状含量')
      features[28] = findField(superplasticizerId, '外加剂', 'waterReducingRate', '外加剂减水率')
      features[29] = findField(superplasticizerId, '外加剂', 'solidContent', '外加剂含固量')
      features[30] = findField(superplasticizerId, '外加剂', 'recommendedDosage', '外加剂推荐掺量')
    } catch (err) {
      console.error('获取材料属性失败，使用-1填充:', err.message)
      warnings.push(`材料属性读取失败，相关材料特征按缺失值处理: ${err.message}`)
    }

    features[31] = temperature ?? 20
    features[32] = humidity ?? 95
    features[33] = curingAge ?? 28

    return { features, warnings }
  }

  clearCache() {
    this._models = null
    this._featureConfig = null
    this._loading = null
  }
}

module.exports = new XGBoostPredictionService()
