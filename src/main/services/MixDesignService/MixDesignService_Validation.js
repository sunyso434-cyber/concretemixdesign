const MixDesignService_Strength = require('./MixDesignService_Strength')
const MixDesignService_WaterRatio = require('./MixDesignService_WaterRatio')

class MixDesignService_Validation {
  // 验证配合比
  async validateMixDesign(mixDesign) {
    try {
      const { strength, waterRatio, materials } = mixDesign

      // 1. 验证水胶比（需根据强度等级重新计算允许的最大水胶比）
      const stdDev = await MixDesignService_Strength.getStrengthStdDev(strength)
      const targetStrength = MixDesignService_Strength.calculateTargetStrength(strength, stdDev)
      const { alphaA, alphaB } = await MixDesignService_WaterRatio.getRegressionCoefficients()
      const cementStrength = materials?.cement?.compressiveStrength28d || 48.0
      const requiredWaterRatio = MixDesignService_WaterRatio.calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
      const waterRatioValid = waterRatio <= requiredWaterRatio

      // 2. 验证强度
      const cementAmount = materials.cement || 0
      const flyAshAmount = materials.flyAsh || 0
      const slagAmount = materials.slag || 0
      const lithiumSlagAmount = materials.lithiumSlag || 0
      const compositePowderAmount = materials.compositePowder || 0
      const cementitiousAmount = cementAmount + flyAshAmount + slagAmount + lithiumSlagAmount + compositePowderAmount
      const waterAmount = materials.water || 0
      const actualWaterRatio = waterAmount / cementitiousAmount
      const strengthValid = actualWaterRatio <= requiredWaterRatio

      // 3. 验证容重
      const density = Object.values(materials).reduce((sum, amount) => sum + amount, 0)
      const densityValid = density >= 2350 && density <= 2450

      return {
        waterRatioValid,
        strengthValid,
        densityValid,
        overallValid: waterRatioValid && strengthValid && densityValid
      }
    } catch (error) {
      console.error('验证配合比失败:', error)
      throw error
    }
  }

  // 优化配合比
  async optimizeMixDesign(mixDesign) {
    try {
      // 简化优化，实际应考虑成本、性能等因素
      const { materials } = mixDesign

      // 假设优化目标是降低成本
      // 增加粉煤灰和矿渣粉的比例，减少水泥用量
      const cementitiousAmount = materials.cement + materials.flyAsh + materials.slag
      const optimizedMaterials = {
        ...materials,
        cement: cementitiousAmount * 0.6,
        flyAsh: cementitiousAmount * 0.25,
        slag: cementitiousAmount * 0.15
      }

      return {
        ...mixDesign,
        materials: optimizedMaterials
      }
    } catch (error) {
      console.error('优化配合比失败:', error)
      throw error
    }
  }
}

module.exports = new MixDesignService_Validation()