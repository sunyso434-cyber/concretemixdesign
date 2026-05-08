const SystemService = require('../SystemService')

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

  // 获取强度等级对应的减水剂掺量
  async getSuperplasticizerDosageByStrength(strength, tempSettings = null) {
    try {
      // 从全局设置获取
      const paramName = `superplasticizerDosage_${strength}`
      const dosageParam = await SystemService.getParamByName(paramName)

      if (dosageParam) {
        return parseFloat(dosageParam.value)
      }

      // 默认值
      const strengthNum = parseInt(strength.replace('C', ''))
      const baseStrength = 30
      const baseDosage = 1.8
      const difference = (strengthNum - baseStrength) / 5
      // 获取高级设置中的强度影响参数，默认为0.1%
      const strengthInfluence = tempSettings?.strengthInfluence || 0.1
      return baseDosage + difference * strengthInfluence
    } catch (error) {
      console.error('获取减水剂掺量失败:', error)
      throw error
    }
  }

  // 获取减水剂掺量与减水率关系值
  async getWaterReducingRatePer01Dosage(tempSettings = null) {
    try {
      if (tempSettings && tempSettings.waterReducingRatePer01Dosage !== undefined) {
        return parseFloat(tempSettings.waterReducingRatePer01Dosage)
      }

      const param = await SystemService.getParamByName('waterReducingRatePer01Dosage')
      if (param) {
        return parseFloat(param.value)
      }

      return 2.0 // 默认值
    } catch (error) {
      console.error('获取减水剂掺量与减水率关系值失败:', error)
      throw error
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