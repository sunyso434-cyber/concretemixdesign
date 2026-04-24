/**
 * 大体积混凝土裂缝风险评估服务
 * 基于多维度评分模型 GB 50496-2018
 */
class CrackRiskService {
  // 评分权重
  static WEIGHTS = {
    stress: 0.35,
    gradient: 0.25,
    duration: 0.20,
    material: 0.20
  }

  /**
   * 应力评分 S_stress (0-100)
   * @param {number} stressRatio σ_max / [σ]
   */
  static calculateStressScore(stressRatio) {
    if (stressRatio <= 0.5) return 0
    if (stressRatio <= 0.7) return 25
    if (stressRatio <= 0.85) return 50
    if (stressRatio <= 1.0) return 75
    return 100
  }

  /**
   * 温降速率评分 S_gradient (0-100)
   * @param {number} gradient °C/d
   */
  static calculateGradientScore(gradient) {
    if (gradient <= 1.5) return 0
    if (gradient <= 2.0) return 25
    if (gradient <= 2.5) return 50
    if (gradient <= 3.0) return 75
    return 100
  }

  /**
   * 持续时间评分 S_duration (0-100)
   * @param {number} duration 超过允许应力的持续时间 (d)
   */
  static calculateDurationScore(duration) {
    if (duration <= 0) return 0
    if (duration <= 1) return 25
    if (duration <= 3) return 50
    if (duration <= 7) return 75
    return 100
  }

  /**
   * 材料抗裂评分 S_material (0-100)
   * @param {number} K 抗裂系数
   */
  static calculateMaterialScore(K) {
    if (K >= 1.3) return 0
    if (K >= 1.15) return 33
    if (K >= 1.0) return 66
    return 100
  }

  /**
   * 计算综合裂缝风险指数
   * @param {Object} params
   * @returns {Object} 裂缝风险评估结果
   */
  calculate(params) {
    const {
      maxStress,
      allowableStress,
      tempGradientData,
      exceedDuration = 0,
      crackResistanceCoeff = 1.15,
      strengthGrade
    } = params

    // 1. 计算各维度评分
    const stressRatio = allowableStress > 0 ? maxStress / allowableStress : 0
    const stressScore = CrackRiskService.calculateStressScore(stressRatio)

    const maxGradient = tempGradientData && tempGradientData.length > 0
      ? Math.max(...tempGradientData.map(d => d.gradient || 0))
      : 0
    const gradientScore = CrackRiskService.calculateGradientScore(maxGradient)

    const durationScore = CrackRiskService.calculateDurationScore(exceedDuration)

    const K = crackResistanceCoeff || 1.15
    const materialScore = CrackRiskService.calculateMaterialScore(K)

    // 2. 计算综合风险指数
    const RI = Math.round(
      CrackRiskService.WEIGHTS.stress * stressScore +
      CrackRiskService.WEIGHTS.gradient * gradientScore +
      CrackRiskService.WEIGHTS.duration * durationScore +
      CrackRiskService.WEIGHTS.material * materialScore
    )

    // 3. 判定风险等级
    let riskLevel
    if (RI <= 25) riskLevel = 'low'
    else if (RI <= 50) riskLevel = 'medium'
    else if (RI <= 75) riskLevel = 'high'
    else riskLevel = 'extreme'

    // 4. 生成建议措施
    const recommendations = []
    if (stressScore >= 50) {
      recommendations.push('建议增加保温层厚度或延缓拆模时间')
    }
    if (gradientScore >= 50) {
      recommendations.push('温降速率过大，应加强保温养护')
    }
    if (durationScore >= 50) {
      recommendations.push('应力超限持续时间较长，需持续监测')
    }
    if (materialScore >= 50) {
      recommendations.push('混凝土抗裂性能不足，建议优化配合比')
    }
    if (riskLevel === 'high' || riskLevel === 'extreme') {
      recommendations.push('必须采取裂缝防控措施，并加强温度监测')
    }

    // 5. 查找关键时间点
    const maxGradientDayObj = tempGradientData?.find(d => d.gradient === maxGradient)
    const criticalDays = {
      maxGradientDay: maxGradientDayObj?.day || 0
    }

    return {
      scores: {
        stressScore,
        gradientScore,
        durationScore,
        materialScore
      },
      riskIndex: RI,
      riskLevel,
      criticalDays,
      recommendations,
      details: {
        stressRatio: stressRatio.toFixed(3),
        maxGradient: Number(maxGradient.toFixed(2)),
        exceedDuration,
        K
      }
    }
  }
}

module.exports = new CrackRiskService()