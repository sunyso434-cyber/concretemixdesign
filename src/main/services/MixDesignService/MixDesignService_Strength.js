const SystemService = require('../SystemService')

class MixDesignService_Strength {
  // 获取强度标准差σ（根据强度等级）
  async getStrengthStdDev(strength, tempSettings = null) {
    try {
      // 优先使用临时设置
      if (tempSettings && tempSettings.strengthStdDev) {
        return parseFloat(tempSettings.strengthStdDev)
      }

      // 从全局设置获取
      let stdDevParam = null
      if (strength === 'C20' || strength === 'C15') {
        stdDevParam = await SystemService.getParamByName('strengthStdDev_C20')
      } else if (strength === 'C50' || strength === 'C55' || strength === 'C60') {
        stdDevParam = await SystemService.getParamByName('strengthStdDev_C50')
      } else {
        // C25-C45
        stdDevParam = await SystemService.getParamByName('strengthStdDev_C25')
      }

      if (stdDevParam) {
        return parseFloat(stdDevParam.value)
      }

      // 默认值
      const strengthNum = parseInt(strength.replace('C', ''))
      if (strengthNum <= 20) {
        return 4.0
      } else if (strengthNum >= 50) {
        return 6.0
      } else {
        return 5.0
      }
    } catch (error) {
      console.error('获取强度标准差失败:', error)
      throw error
    }
  }

  // 计算配置强度 f_cu,0 = f_cu,k + 1.645 × σ
  calculateTargetStrength(strength, stdDev) {
    const strengthNum = parseInt(strength.replace('C', ''))
    return strengthNum + 1.645 * stdDev
  }

  // 根据强度等级和临时设置计算目标细度模数（同步）
  // 当用户显式指定 targetFinenessModulusBase 时，该值表示当前强度等级的最终目标细度模数，直接使用，不叠加等级调整
  // 当用户未指定时，使用默认C30基准2.7 + 等级调整
  computeTargetFinenessModulus(strength, tempSettings = null) {
    try {
      const strengthNum = parseInt(String(strength || '').replace('C', '')) || 30

      // 用户显式指定了目标细度模数：直接作为当前强度等级的最终目标，不叠加等级调整
      if (tempSettings && tempSettings.targetFinenessModulusBase !== undefined && tempSettings.targetFinenessModulusBase !== null) {
        return parseFloat(tempSettings.targetFinenessModulusBase)
      }

      // 用户未指定：使用默认C30基准2.7 + 等级调整（每5MPa增加0.1）
      const baseFm = 2.7
      const target = baseFm + (strengthNum - 30) * 0.02

      return Number(target.toFixed(2))
    } catch (error) {
      return 2.7
    }
  }
}

module.exports = new MixDesignService_Strength()