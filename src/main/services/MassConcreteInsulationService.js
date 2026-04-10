const MassConcreteInsulation = require('../db/models/MassConcreteInsulation')
const InsulationMaterial = require('../db/models/InsulationMaterial')

/**
 * 大体积混凝土保温层计算服务
 * 基于 GB 50496-2018《大体积混凝土施工标准》附录C
 */
class MassConcreteInsulationService {
  // 混凝土导热系数 W/(m·K)
  static CONCRETE_LAMBDA = 1.74

  // 表面传热系数表 beta_t [W/(m²·K)]
  // 行：风速 (m/s): 0, 2, 4, 6, 8, 10
  // 列：表面粗糙度: verySmooth(光滑), smooth(平整), rough(粗糙)
  static BETA_T_TABLE = {
    0: { verySmooth: 12.5, smooth: 14.0, rough: 18.0 },
    2: { verySmooth: 16.3, smooth: 18.5, rough: 23.0 },
    4: { verySmooth: 20.0, smooth: 23.0, rough: 29.0 },
    6: { verySmooth: 24.0, smooth: 28.0, rough: 35.0 },
    8: { verySmooth: 28.0, smooth: 33.0, rough: 41.0 },
    10: { verySmooth: 32.0, smooth: 38.0, rough: 47.0 }
  }

  // 保温层传热系数修正系数 Kb
  // 按保温层类型（风速大时取值不同）
  static KB_TABLE = {
    windproof: { // 防风保温
      0: 1.0, 2: 1.0, 4: 1.05, 6: 1.10, 8: 1.15, 10: 1.20
    },
    normal: { // 普通保温
      0: 1.0, 2: 1.05, 4: 1.15, 6: 1.30, 8: 1.50, 10: 1.80
    }
  }

  /**
   * 根据风速和表面粗糙度获取表面传热系数
   * @param {number} windSpeed - 风速 m/s
   * @param {string} surfaceRoughness - 表面粗糙度 verySmooth/smooth/rough
   * @returns {number} beta_t W/(m²·K)
   */
  static getBetaT(windSpeed, surfaceRoughness) {
    const speeds = Object.keys(MassConcreteInsulationService.BETA_T_TABLE)
      .map(Number)
      .sort((a, b) => a - b)

    // 边界处理
    if (windSpeed <= speeds[0]) {
      return MassConcreteInsulationService.BETA_T_TABLE[speeds[0]][surfaceRoughness] || 18.0
    }
    if (windSpeed >= speeds[speeds.length - 1]) {
      return MassConcreteInsulationService.BETA_T_TABLE[speeds[speeds.length - 1]][surfaceRoughness] || 47.0
    }

    // 线性插值
    let lower = speeds[0]
    let upper = speeds[speeds.length - 1]
    for (let i = 0; i < speeds.length - 1; i++) {
      if (windSpeed >= speeds[i] && windSpeed <= speeds[i + 1]) {
        lower = speeds[i]
        upper = speeds[i + 1]
        break
      }
    }

    const t = (windSpeed - lower) / (upper - lower)
    const lowerVal = MassConcreteInsulationService.BETA_T_TABLE[lower][surfaceRoughness] || 18.0
    const upperVal = MassConcreteInsulationService.BETA_T_TABLE[upper][surfaceRoughness] || 47.0

    return lowerVal + t * (upperVal - lowerVal)
  }

  /**
   * 根据风速和保温类型获取修正系数 Kb
   * @param {number} windSpeed - 风速 m/s
   * @param {string} insulationType - 保温类型 windproof/normal
   * @returns {number} Kb 修正系数
   */
  static getKb(windSpeed, insulationType) {
    const kbTable = MassConcreteInsulationService.KB_TABLE[insulationType] || MassConcreteInsulationService.KB_TABLE.normal
    const speeds = Object.keys(kbTable).map(Number).sort((a, b) => a - b)

    // 边界处理
    if (windSpeed <= speeds[0]) {
      return kbTable[speeds[0]]
    }
    if (windSpeed >= speeds[speeds.length - 1]) {
      return kbTable[speeds[speeds.length - 1]]
    }

    // 线性插值
    let lower = speeds[0]
    let upper = speeds[speeds.length - 1]
    for (let i = 0; i < speeds.length - 1; i++) {
      if (windSpeed >= speeds[i] && windSpeed <= speeds[i + 1]) {
        lower = speeds[i]
        upper = speeds[i + 1]
        break
      }
    }

    const t = (windSpeed - lower) / (upper - lower)
    return kbTable[lower] + t * (kbTable[upper] - kbTable[lower])
  }

  /**
   * 获取保温材料导热系数
   * @param {number} materialId - 材料ID
   * @returns {Promise<number>} 导热系数 W/(m·K)
   */
  async getMaterialThermalConductivity(materialId) {
    const material = await InsulationMaterial.findByPk(materialId)
    return material ? material.thermalConductivity : 0.04 // 默认值
  }

  /**
   * 获取所有保温材料
   * @returns {Promise<Array>} 保温材料列表
   */
  async getInsulationMaterials() {
    try {
      const materials = await InsulationMaterial.findAll({
        order: [
          ['isDefault', 'DESC'],
          ['name', 'ASC']
        ]
      })
      return materials.map(m => m.toJSON())
    } catch (error) {
      console.error('获取保温材料列表失败:', error)
      throw error
    }
  }

  /**
   * 计算保温层厚度
   * 基于 GB 50496-2018 附录C
   * @param {Object} params - 计算参数
   * @param {number} params.concreteThickness - 混凝土厚度 m
   * @param {Array} params.insulationLayers - 保温层配置 [{material_id, thickness}]
   * @param {number} params.windSpeed - 风速 m/s
   * @param {string} params.surfaceRoughness - 表面粗糙度 verySmooth/smooth/rough
   * @param {string} params.insulationType - 保温类型 windproof/normal
   * @param {number} params.targetTempDiff - 目标表面温差 ℃ (default 25)
   * @param {number} params.maxAdiabaticTemp - 最大绝热温升 ℃ (required)
   * @returns {Object} 计算结果
   */
  async calculate(params) {
    const {
      concreteThickness,
      insulationLayers = [],
      windSpeed,
      surfaceRoughness,
      insulationType,
      targetTempDiff = 25,
      maxAdiabaticTemp
    } = params

    if (!maxAdiabaticTemp) {
      throw new Error('最大绝热温升 maxAdiabaticTemp 是必需参数')
    }

    console.log('[保温层计算] 输入参数:', {
      concreteThickness,
      insulationLayers,
      windSpeed,
      surfaceRoughness,
      insulationType,
      targetTempDiff,
      maxAdiabaticTemp
    })

    // 1. 获取表面传热系数 beta_t
    const betaT = MassConcreteInsulationService.getBetaT(windSpeed, surfaceRoughness)

    // 2. 获取保温层修正系数 Kb
    const Kb = MassConcreteInsulationService.getKb(windSpeed, insulationType)

    // 3. 获取各保温层材料的导热系数
    const layerData = []
    let sumDeltaLambda = 0 // sum(delta_i / lambda_i)

    for (const layer of insulationLayers) {
      const material = await InsulationMaterial.findByPk(layer.material_id)
      const lambda = material ? material.thermalConductivity : 0.04
      const delta = layer.thickness / 1000 // mm 转 m
      const deltaLambda = delta / lambda
      sumDeltaLambda += deltaLambda

      layerData.push({
        materialId: layer.material_id,
        materialName: material ? material.name : '未知',
        thickness: layer.thickness,
        thermalConductivity: lambda,
        deltaLambda
      })
    }

    // 4. 计算总热阻 Rs = sum(delta_i/lambda_i) + 1/beta_t
    const Rs = sumDeltaLambda + 1 / betaT

    // 5. 计算总传热系数 beta_s = 1 / Rs
    const betaS = 1 / Rs

    // 6. 应用风速修正 beta_s' = Kb * beta_s
    const betaSPrime = Kb * betaS

    // 7. 计算虚厚度 h' = lambda_0 / beta_s'
    const hPrime = MassConcreteInsulationService.CONCRETE_LAMBDA / betaSPrime

    // 8. 计算表面温度差 deltaT1 = Tmax * (1 - 1/cosh(beta * h'))
    // 其中 beta = pi * sqrt(3) / L (L为混凝土结构特征尺寸，这里简化为厚度)
    // 附录C简化公式：deltaT1 = Tmax * (1 - 1/cosh(sqrt(pi^2 * lambda / (h' * lambda_0)) * h'))
    const beta = Math.PI * Math.sqrt(MassConcreteInsulationService.CONCRETE_LAMBDA / (hPrime * MassConcreteInsulationService.CONCRETE_LAMBDA))
    const coshTerm = Math.cosh(beta * hPrime)
    const deltaT1 = maxAdiabaticTemp * (1 - 1 / coshTerm)

    // 9. 迭代计算：如果 deltaT1 > targetTempDiff，需要增加保温层厚度
    let requiredAdditionalThickness = 0
    let currentDeltaT1 = deltaT1
    let iterationCount = 0
    const maxIterations = 50

    // 取最小保温材料导热系数作为迭代目标
    const minLambda = layerData.length > 0
      ? Math.min(...layerData.map(l => l.thermalConductivity))
      : 0.04

    while (currentDeltaT1 > targetTempDiff && iterationCount < maxIterations) {
      iterationCount++
      // 增加保温层厚度（每次增加5mm）
      requiredAdditionalThickness += 5

      // 重新计算
      const additionalDeltaLambda = (requiredAdditionalThickness / 1000) / minLambda
      const newRs = sumDeltaLambda + additionalDeltaLambda + 1 / betaT
      const newBetaS = 1 / newRs
      const newBetaSPrime = Kb * newBetaS
      const newHPrime = MassConcreteInsulationService.CONCRETE_LAMBDA / newBetaSPrime
      const newBeta = Math.PI * Math.sqrt(MassConcreteInsulationService.CONCRETE_LAMBDA / (newHPrime * MassConcreteInsulationService.CONCRETE_LAMBDA))
      const newCoshTerm = Math.cosh(newBeta * newHPrime)
      currentDeltaT1 = maxAdiabaticTemp * (1 - 1 / newCoshTerm)
    }

    console.log('[保温层计算] 结果:', {
      betaT: betaT.toFixed(2),
      Kb: Kb.toFixed(3),
      Rs: Rs.toFixed(4),
      betaS: betaS.toFixed(4),
      betaSPrime: betaSPrime.toFixed(4),
      hPrime: hPrime.toFixed(4),
      deltaT1: deltaT1.toFixed(2),
      currentDeltaT1: currentDeltaT1.toFixed(2),
      requiredAdditionalThickness,
      iterationCount
    })

    return {
      // 输入参数
      input: {
        concreteThickness,
        windSpeed,
        surfaceRoughness,
        insulationType,
        targetTempDiff,
        maxAdiabaticTemp
      },
      // 保温层配置
      insulationLayers: layerData,
      // 热工计算参数
      thermal: {
        concreteLambda: MassConcreteInsulationService.CONCRETE_LAMBDA,
        betaT,
        Kb,
        Rs,
        betaS,
        betaSPrime,
        hPrime
      },
      // 温差计算
      tempDiff: {
        calculated: deltaT1,
        afterIteration: currentDeltaT1,
        meetsRequirement: currentDeltaT1 <= targetTempDiff
      },
      // 保温层厚度结果
      thickness: {
        additionalRequired: requiredAdditionalThickness,
        unit: 'mm'
      },
      // 迭代信息
      iteration: {
        count: iterationCount,
        converged: iterationCount < maxIterations
      },
      // 计算公式
      formulas: {
        Rs: 'Rs = sum(delta_i/lambda_i) + 1/beta_t',
        betaS: 'beta_s = 1 / Rs',
        betaSPrme: "beta_s' = Kb * beta_s",
        hPrime: "h' = lambda_0 / beta_s'",
        deltaT1: 'deltaT1 = Tmax * (1 - 1/cosh(beta * h))'
      }
    }
  }

  /**
   * 保存保温层计算结果
   * @param {number} schemeId - 方案ID
   * @param {Object} data - 计算结果数据
   * @returns {Promise<Object>} 保存后的数据
   */
  async saveResult(schemeId, data) {
    try {
      // 查找是否已存在该方案的保温层记录
      let insulation = await MassConcreteInsulation.findOne({ where: { schemeId } })

      // 准备保存的数据
      const saveData = {
        schemeId,
        windSpeed: data.input.windSpeed,
        surfaceRoughness: data.input.surfaceRoughness,
        insulationLayers: data.insulationLayers,
        totalThermalResistance: data.thermal.Rs,
        totalHeatTransfer: data.thermal.betaSPrime,
        virtualThickness: data.thermal.hPrime,
        calculatedThickness: data.thickness.additionalRequired,
        surfaceTempDiff: data.tempDiff.afterIteration,
        meetsRequirement: data.tempDiff.meetsRequirement
      }

      if (insulation) {
        // 更新现有记录
        await insulation.update(saveData)
        console.log('[保温层保存] 更新方案' + schemeId + '的保温层成功')
        return insulation.toJSON()
      } else {
        // 创建新记录
        insulation = await MassConcreteInsulation.create(saveData)
        console.log('[保温层保存] 新增方案' + schemeId + '的保温层成功')
        return insulation.toJSON()
      }
    } catch (error) {
      console.error('[保温层保存] 保存保温层失败:', error)
      throw error
    }
  }

  /**
   * 获取方案的保温层结果
   * @param {number} schemeId - 方案ID
   * @returns {Promise<Object|null>}
   */
  async getResultBySchemeId(schemeId) {
    try {
      const insulation = await MassConcreteInsulation.findOne({ where: { schemeId } })
      return insulation ? insulation.toJSON() : null
    } catch (error) {
      console.error('[保温层获取] 获取保温层失败:', error)
      throw error
    }
  }
}

module.exports = new MassConcreteInsulationService()
