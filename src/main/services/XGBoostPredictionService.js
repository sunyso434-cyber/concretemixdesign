const fs = require('fs')
const path = require('path')
const MaterialService = require('./MaterialService')
const MixFormatConverter = require('./MixFormatConverter')

const MODELS_DIR = path.join(__dirname, '..', '..', 'resources', 'models')

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

      const features = await this._buildFeatureVector(inputParams)

      const predictions = {}
      const allWarnings = []

      for (const [target, model] of Object.entries(models)) {
        const { value, warnings } = this._predictOne(model, features)
        const { confidence } = this._checkFeatureRange(model, features)

        predictions[target] = {
          value: Math.round(value * 100) / 100,
          unit: RESULT_UNITS[target] || '',
          confidence
        }

        allWarnings.push(...warnings)
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
        warnings: allWarnings,
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
    const { trees, learning_rate, base_score } = model

    let sum = base_score || 0

    for (const tree of trees) {
      const leafValue = this._traverseTree(tree, 0, features)
      sum += learning_rate * leafValue
    }

    return {
      value: sum,
      warnings: []
    }
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

    return { confidence, warnings }
  }

  async _buildFeatureVector(inputParams) {
    const features = new Array(34).fill(-1)

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
        matById.set(m.id, m)
      }

      const findField = (id, type, field) => {
        if (!id) return -1
        const mat = matById.get(id)
        if (!mat) return -1
        if (mat.type !== type) return -1
        const val = mat[field]
        return val !== undefined && val !== null ? val : -1
      }

      features[13] = findField(cementId, '水泥', 'compressiveStrength28d')
      features[14] = findField(cementId, '水泥', 'standardConsistency')
      features[15] = findField(flyAshId, '粉煤灰', 'activityIndex28d')
      features[16] = findField(flyAshId, '粉煤灰', 'waterDemandRatio')
      features[17] = findField(slagId, '矿渣粉', 'activityIndex28d')
      features[18] = findField(slagId, '矿渣粉', 'fluidityRatio')
      features[19] = findField(lithiumSlagId, '锂渣', 'activityIndex28d')
      features[20] = findField(lithiumSlagId, '锂渣', 'waterDemandRatio')
      features[21] = findField(compositePowderId, '复合粉', 'activityIndex28d')
      features[22] = findField(compositePowderId, '复合粉', 'waterDemandRatio')
      features[23] = findField(sandId, '细骨料', 'finenessModulus')
      features[24] = findField(sandId, '细骨料', 'mbValue')
      features[25] = findField(sandId, '细骨料', 'mudContent')
      features[26] = findField(stoneId, '粗骨料', 'crushingValue')
      features[27] = findField(stoneId, '粗骨料', 'needleFlakeContent')
      features[28] = findField(superplasticizerId, '外加剂', 'waterReducingRate')
      features[29] = findField(superplasticizerId, '外加剂', 'solidContent')
      features[30] = findField(superplasticizerId, '外加剂', 'recommendedDosage')
    } catch (err) {
      console.error('获取材料属性失败，使用-1填充:', err.message)
    }

    features[31] = temperature ?? 20
    features[32] = humidity ?? 95
    features[33] = curingAge ?? 28

    return features
  }

  clearCache() {
    this._models = null
    this._featureConfig = null
    this._loading = null
  }
}

module.exports = new XGBoostPredictionService()