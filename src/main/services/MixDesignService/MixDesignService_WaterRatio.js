const SystemService = require('../SystemService')

// ponytail: 终极兜底常量 — 没选减水剂材料 / 材料无 recommendedDosage / 用户也没填 C30 基准时使用
const DEFAULT_DOSAGE_FALLBACK = 1.8
// ponytail: 每 5 个强度等级（10MPa）的掺量增量（%）
const DOSAGE_STEP_PER_5_STRENGTH = 0.1

class MixDesignService_WaterRatio {
  // 获取回归系数
  async getRegressionCoefficients(tempSettings = null) {
    try {
      let alphaA = 0.53 // 默认值（碎石）
      let alphaB = 0.20 // 默认值（碎石）

      // 优先使用临时设置
      if (tempSettings) {
        if (tempSettings.regressionAlphaA !== undefined) {
          alphaA = parseFloat(tempSettings.regressionAlphaA)
        }
        if (tempSettings.regressionAlphaB !== undefined) {
          alphaB = parseFloat(tempSettings.regressionAlphaB)
        }
      } else {
        // 从全局设置获取
        const alphaAParam = await SystemService.getParamByName('regressionAlphaA')
        const alphaBParam = await SystemService.getParamByName('regressionAlphaB')

        if (alphaAParam) alphaA = parseFloat(alphaAParam.value)
        if (alphaBParam) alphaB = parseFloat(alphaBParam.value)
      }

      return { alphaA, alphaB }
    } catch (error) {
      console.error('获取回归系数失败:', error)
      throw error
    }
  }

  // 计算水胶比 W/B = (α_a × f_b) / (f_cu,0 + α_a × α_b × f_b)
  calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB) {
    const numerator = alphaA * cementStrength
    const denominator = targetStrength + alphaA * alphaB * cementStrength
    return numerator / denominator
  }

  // 获取 C30 减水剂掺量基准（决定其他等级派生）
  // 优先级：用户填的 C30 基准 > 减水剂材料 recommendedDosage > 1.8 兜底
  async getC30Baseline(superplasticizerMaterial, tempSettings = null) {
    try {
      if (tempSettings?.superplasticizerDosageBase_C30 !== undefined
          && tempSettings.superplasticizerDosageBase_C30 !== null
          && tempSettings.superplasticizerDosageBase_C30 !== '') {
        return parseFloat(tempSettings.superplasticizerDosageBase_C30)
      }

      const baseParam = await SystemService.getParamByName('superplasticizerDosageBase_C30')
      if (baseParam && baseParam.value !== '' && baseParam.value !== null) {
        return parseFloat(baseParam.value)
      }

      if (superplasticizerMaterial && superplasticizerMaterial.recommendedDosage) {
        return parseFloat(superplasticizerMaterial.recommendedDosage)
      }

      return DEFAULT_DOSAGE_FALLBACK
    } catch (error) {
      console.error('获取 C30 减水剂掺量基准失败:', error)
      return DEFAULT_DOSAGE_FALLBACK
    }
  }

  // 获取强度等级对应的减水剂掺量（基础掺量，不含砂石微调）
  // - 没选减水剂材料 → 0
  // - 用户单点指定了该等级 → 用指定值
  // - 否则 → C30 基准 + (强度差/5) × 0.1%
  async getSuperplasticizerDosageByStrength(strength, superplasticizerMaterial, tempSettings = null) {
    try {
      // 没选减水剂材料 → 0
      if (!superplasticizerMaterial) {
        return 0
      }

      // 用户单点指定了该等级
      const paramName = `superplasticizerDosage_${strength}`
      if (tempSettings?.[paramName] !== undefined && tempSettings[paramName] !== '' && tempSettings[paramName] !== null) {
        return parseFloat(tempSettings[paramName])
      }
      const dosageParam = await SystemService.getParamByName(paramName)
      if (dosageParam && dosageParam.value !== '' && dosageParam.value !== null) {
        return parseFloat(dosageParam.value)
      }

      // 派生：基准 + (强度差 / 5) × 0.1
      const c30Baseline = await this.getC30Baseline(superplasticizerMaterial, tempSettings)
      const strengthNum = parseInt(String(strength).replace('C', ''), 10)
      const strengthInfluence = tempSettings?.strengthInfluence || DOSAGE_STEP_PER_5_STRENGTH
      return c30Baseline + ((strengthNum - 30) / 5) * strengthInfluence
    } catch (error) {
      console.error('获取减水剂掺量失败:', error)
      throw error
    }
  }

  // 获取减水剂掺量与减水率关系值（每 0.1% 掺量 → 减水率增量 %）
  // 新规则：优先用减水剂材料字段，回落 JGJ55 全局值，再回落 2.0
  async getWaterReducingRatePer01Dosage(superplasticizerMaterial = null, tempSettings = null) {
    try {
      if (superplasticizerMaterial && superplasticizerMaterial.waterReducingRatePer01Dosage) {
        return parseFloat(superplasticizerMaterial.waterReducingRatePer01Dosage)
      }
      if (tempSettings && tempSettings.waterReducingRatePer01Dosage !== undefined) {
        return parseFloat(tempSettings.waterReducingRatePer01Dosage)
      }
      const param = await SystemService.getParamByName('waterReducingRatePer01Dosage')
      if (param && param.value !== '' && param.value !== null) {
        return parseFloat(param.value)
      }
      return 2.0
    } catch (error) {
      console.error('获取减水剂掺量与减水率关系值失败:', error)
      return 2.0
    }
  }

  // 计算掺合料影响系数（线性插值）
  calculateInfluenceFactor(admixtureDosage, admixtureMaterial) {
    try {
      // 固定掺量档位
      const dosageLevels = [10, 20, 30, 40, 50]

      // 从原材料获取各档位的影响系数，确保不为0
      const factors = {
        10: Math.max(0.1, admixtureMaterial?.influenceFactor_10 || 1.0),
        20: Math.max(0.1, admixtureMaterial?.influenceFactor_20 || 1.0),
        30: Math.max(0.1, admixtureMaterial?.influenceFactor_30 || 1.05),
        40: Math.max(0.1, admixtureMaterial?.influenceFactor_40 || 1.1),
        50: Math.max(0.1, admixtureMaterial?.influenceFactor_50 || 1.15)
      }

      console.log('掺合料影响系数档位:', factors)

      // 找到上下两个档位
      let lowerLevel = dosageLevels[0]
      let upperLevel = dosageLevels[dosageLevels.length - 1]

      for (let i = 0; i < dosageLevels.length - 1; i++) {
        if (admixtureDosage >= dosageLevels[i] && admixtureDosage <= dosageLevels[i + 1]) {
          lowerLevel = dosageLevels[i]
          upperLevel = dosageLevels[i + 1]
          break
        }
      }

      // 如果低于最低档或高于最高档，使用边界值
      if (admixtureDosage < lowerLevel) {
        return factors[lowerLevel]
      }
      if (admixtureDosage > upperLevel) {
        return factors[upperLevel]
      }

      // 线性插值
      const lowerFactor = factors[lowerLevel]
      const upperFactor = factors[upperLevel]
      const t = (admixtureDosage - lowerLevel) / (upperLevel - lowerLevel)
      const finalFactor = lowerFactor + t * (upperFactor - lowerFactor)

      console.log('掺合料影响系数计算:', {
        admixtureDosage,
        lowerLevel,
        upperLevel,
        lowerFactor,
        upperFactor,
        t,
        finalFactor
      })

      return Math.max(0.1, finalFactor)
    } catch (error) {
      console.error('计算掺合料影响系数失败:', error)
      return 1.0
    }
  }
}

module.exports = new MixDesignService_WaterRatio()