const InsulationMaterial = require('../db/models/InsulationMaterial')

/**
 * 双向保温计算服务
 * 同时计算顶面和侧面的保温效果
 */
class BidirectionalInsulationService {
  static CONCRETE_LAMBDA = 1.74

  // 获取保温材料
  async getMaterial(materialId) {
    if (!materialId) return null
    const material = await InsulationMaterial.findByPk(materialId)
    return material ? material.toJSON() : null
  }

  // 获取表面传热系数 beta_t
  static getBetaT(windSpeed, surfaceRoughness) {
    const BETA_T_TABLE = {
      0: { verySmooth: 12.5, smooth: 14.0, rough: 18.0 },
      2: { verySmooth: 16.3, smooth: 18.5, rough: 23.0 },
      4: { verySmooth: 20.0, smooth: 23.0, rough: 29.0 },
      6: { verySmooth: 24.0, smooth: 28.0, rough: 35.0 },
      8: { verySmooth: 28.0, smooth: 33.0, rough: 41.0 },
      10: { verySmooth: 32.0, smooth: 38.0, rough: 47.0 }
    }

    const speeds = Object.keys(BETA_T_TABLE).map(Number).sort((a, b) => a - b)
    const ws = Math.max(0, Math.min(10, windSpeed))

    // 插值
    let lower = speeds[0]
    let upper = speeds[speeds.length - 1]
    for (let i = 0; i < speeds.length - 1; i++) {
      if (ws >= speeds[i] && ws <= speeds[i + 1]) {
        lower = speeds[i]
        upper = speeds[i + 1]
        break
      }
    }

    if (ws === lower) {
      return BETA_T_TABLE[lower][surfaceRoughness] || 18.0
    }

    const t = (ws - lower) / (upper - lower)
    return (1 - t) * BETA_T_TABLE[lower][surfaceRoughness] + t * BETA_T_TABLE[upper][surfaceRoughness]
  }

  // 获取修正系数 Kb
  static getKb(windSpeed, insulationType) {
    const KB_TABLE = {
      windproof: { 0: 1.0, 2: 1.0, 4: 1.05, 6: 1.10, 8: 1.15, 10: 1.20 },
      normal: { 0: 1.0, 2: 1.05, 4: 1.15, 6: 1.30, 8: 1.50, 10: 1.80 }
    }
    const table = KB_TABLE[insulationType] || KB_TABLE.normal
    const ws = Math.max(0, Math.min(10, windSpeed))
    return table[ws] || 1.0
  }

  // 计算单向热阻
  async calculateThermalResistance(layers, betaT) {
    let sumDeltaLambda = 0
    const layerData = []

    for (const layer of layers) {
      if (!layer.material_id) continue
      const material = await this.getMaterial(layer.material_id)
      const lambda = material?.thermalConductivity || 0.04
      const delta = (layer.thickness || 50) / 1000
      sumDeltaLambda += delta / lambda
      layerData.push({
        materialId: layer.material_id,
        materialName: material?.name || '未知',
        thickness: layer.thickness || 50,
        thermalConductivity: lambda
      })
    }

    return {
      Rs: sumDeltaLambda + 1 / betaT,
      layerData
    }
  }

  // 计算虚厚度
  static calculateVirtualThickness(lambda0, betaSPrime) {
    return lambda0 / betaSPrime
  }

  // 计算温差
  static calculateTempDiff(Tmax, beta, hPrime) {
    return Tmax * (1 - 1 / Math.cosh(beta * hPrime))
  }

  // 计算单向保温
  async calculateSingleSide(params, boundary, insulationConfig) {
    if (!insulationConfig?.enabled) {
      return null
    }

    const betaT = BidirectionalInsulationService.getBetaT(
      boundary.windSpeed,
      boundary.surfaceRoughness
    )
    const Kb = BidirectionalInsulationService.getKb(
      boundary.windSpeed,
      boundary.insulationType || 'normal'
    )

    const { Rs, layerData } = await this.calculateThermalResistance(
      insulationConfig.layers || [],
      betaT
    )

    const betaSPrime = Kb / Rs
    const hPrime = BidirectionalInsulationService.calculateVirtualThickness(
      BidirectionalInsulationService.CONCRETE_LAMBDA,
      betaSPrime
    )

    // 计算特征系数 beta
    const lambda0 = BidirectionalInsulationService.CONCRETE_LAMBDA
    const beta = Math.PI * Math.sqrt(lambda0 / (hPrime * lambda0))

    const deltaT = BidirectionalInsulationService.calculateTempDiff(
      params.maxAdiabaticTemp,
      beta,
      hPrime
    )

    return {
      layers: layerData,
      betaT: Math.round(betaT * 100) / 100,
      Kb: Math.round(Kb * 1000) / 1000,
      Rs: Math.round(Rs * 1000) / 1000,
      betaSPrime: Math.round(betaSPrime * 1000) / 1000,
      hPrime: Math.round(hPrime * 1000) / 1000,
      tempDiff: Math.round(deltaT * 100) / 100,
      meetsRequirement: deltaT <= params.targetTempDiff
    }
  }

  /**
   * 双向保温计算主方法
   */
  async calculate(params) {
    const {
      concreteThickness = 2,
      concreteLength = 50,
      concreteWidth = 20,
      topInsulation,
      sideInsulation,
      boundaryConditions = {},
      targetTempDiff = 25,
      maxAdiabaticTemp = 55
    } = params

    // 1. 计算顶面
    const topResult = await this.calculateSingleSide(
      { maxAdiabaticTemp, targetTempDiff },
      boundaryConditions.top || { windSpeed: 0, surfaceRoughness: 'smooth', insulationType: 'normal' },
      topInsulation
    )

    // 2. 计算侧面
    const sideResult = await this.calculateSingleSide(
      { maxAdiabaticTemp, targetTempDiff },
      boundaryConditions.side || { windSpeed: 0, surfaceRoughness: 'smooth', insulationType: 'normal' },
      sideInsulation
    )

    // 3. 底面温差（简化）
    const bottomType = boundaryConditions.bottom?.type || 'basement'
    const bottomTempDiff = bottomType === 'basement' ? 15 : bottomType === 'exposed' ? 20 : 10

    // 4. 综合评估
    const validDiffs = [
      topResult?.tempDiff || 0,
      sideResult?.tempDiff || 0,
      bottomTempDiff
    ].filter(v => v > 0)

    const maxTempDiff = validDiffs.length > 0 ? Math.max(...validDiffs) : 0

    return {
      top: topResult,
      side: sideResult,
      bottom: {
        type: bottomType,
        tempDiff: bottomTempDiff
      },
      maxTempDiff: Math.round(maxTempDiff * 100) / 100,
      meetsRequirement: maxTempDiff <= targetTempDiff,
      recommendations: this.generateRecommendations(topResult, sideResult, targetTempDiff)
    }
  }

  generateRecommendations(topResult, sideResult, targetTempDiff) {
    const recs = []
    if (topResult && !topResult.meetsRequirement) {
      recs.push('顶面保温层厚度不足，建议增加保温材料')
    }
    if (sideResult && !sideResult.meetsRequirement) {
      recs.push('侧面保温层厚度不足，建议增加保温材料')
    }
    if (!topResult && !sideResult) {
      recs.push('未配置保温层，建议添加保温措施')
    }
    return recs
  }
}

module.exports = new BidirectionalInsulationService()