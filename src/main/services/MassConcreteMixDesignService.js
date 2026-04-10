const MassConcreteMixDesign = require('../db/models/MassConcreteMixDesign')

/**
 * 大体积混凝土配合比设计服务
 * 基于 GB 50496-2018《大体积混凝土施工标准》
 */
class MassConcreteMixDesignService {
  // 粉煤灰影响系数 k1 表
  static FLY_ASH_K1 = {
    0: 1.00,
    10: 0.96,
    20: 0.95,
    30: 0.93,
    40: 0.82,
    50: 0.75
  }

  // 矿渣粉影响系数 k2 表
  static SLAG_K2 = {
    0: 1.00,
    10: 1.00,
    20: 0.93,
    30: 0.92,
    40: 0.84,
    50: 0.79
  }

  /**
   * 根据掺量插值计算系数
   * @param {number} dosage - 掺量百分比 (0-50)
   * @param {Object} table - 系数表 {掺量: 系数}
   * @returns {number} 插值后的系数
   */
  static interpolateK(dosage, table) {
    const dosages = Object.keys(table).map(Number).sort((a, b) => a - b)

    // 边界处理
    if (dosage <= dosages[0]) {
      return table[dosages[0]]
    }
    if (dosage >= dosages[dosages.length - 1]) {
      return table[dosages[dosages.length - 1]]
    }

    // 找到上下边界
    let lower = dosages[0]
    let upper = dosages[dosages.length - 1]
    for (let i = 0; i < dosages.length - 1; i++) {
      if (dosage >= dosages[i] && dosage <= dosages[i + 1]) {
        lower = dosages[i]
        upper = dosages[i + 1]
        break
      }
    }

    // 线性插值
    const t = (dosage - lower) / (upper - lower)
    return table[lower] + t * (table[upper] - table[lower])
  }

  /**
   * 计算配合比设计
   * @param {Object} params - 计算参数
   * @param {string} params.strengthGrade - 强度等级 (如 'C30')
   * @param {string} params.cementType - 水泥类型
   * @param {number} params.cementContent - 水泥用量 kg/m³
   * @param {number} params.flyAshContent - 粉煤灰用量 kg/m³
   * @param {number} params.slagContent - 矿渣粉用量 kg/m³
   * @param {number} params.waterBinderRatio - 水胶比
   * @param {number} params.sandRatio - 砂率 %
   * @param {number} params.cementHeat3d - 水泥3d水化热 kJ/kg
   * @param {number} params.cementHeat7d - 水泥7d水化热 kJ/kg
   * @returns {Object} 计算结果
   */
  calculate(params) {
    const {
      strengthGrade,
      cementType,
      cementContent,
      flyAshContent,
      slagContent,
      waterBinderRatio,
      sandRatio,
      cementHeat3d,
      cementHeat7d
    } = params

    // 1. 计算 Q0 = 4 / (7/Q7 - 3/Q3)
    // Q0: 胶凝材料等效龄期时的水化热参考值
    const Q0 = 4 / (7 / cementHeat7d - 3 / cementHeat3d)

    // 2. 计算粉煤灰和矿渣粉的掺量比例
    const totalBinder = cementContent + flyAshContent + slagContent
    const flyAshRatio = totalBinder > 0 ? (flyAshContent / totalBinder) * 100 : 0
    const slagRatio = totalBinder > 0 ? (slagContent / totalBinder) * 100 : 0

    // 3. 根据掺量比例查表插值计算 k1, k2
    const k1 = MassConcreteMixDesignService.interpolateK(flyAshRatio, MassConcreteMixDesignService.FLY_ASH_K1)
    const k2 = MassConcreteMixDesignService.interpolateK(slagRatio, MassConcreteMixDesignService.SLAG_K2)

    // 4. 计算综合影响系数 k
    // 当同时使用粉煤灰和矿渣粉时：k = k1 + k2 - 1
    // 当只使用其中一种时：k = 对应系数
    let k
    if (flyAshRatio > 0 && slagRatio > 0) {
      k = k1 + k2 - 1
    } else if (flyAshRatio > 0) {
      k = k1
    } else if (slagRatio > 0) {
      k = k2
    } else {
      k = 1.0
    }

    // 5. 计算总发热量 Q = k * Q0
    const totalHeat = k * Q0

    // 6. 计算用水量
    const waterContent = waterBinderRatio * totalBinder

    // 7. 计算砂用量
    // 公式：砂 = 砂率 * (胶凝材料 + 水) * 2.4
    const sandContent = (sandRatio / 100) * (totalBinder + waterContent) * 2.4

    // 8. 计算石用量
    // 公式：石 = (1 - 砂率) * (胶凝材料 + 水) * 2.4
    const stoneContent = (1 - sandRatio / 100) * (totalBinder + waterContent) * 2.4

    // 9. 外加剂用量（简化计算，按胶凝材料的1.5%）
    const admixtureContent = totalBinder * 0.015

    console.log('[大体积混凝土配合比计算] 参数:', {
      strengthGrade,
      cementContent,
      flyAshContent,
      slagContent,
      totalBinder,
      waterBinderRatio,
      sandRatio,
      cementHeat3d,
      cementHeat7d
    })

    console.log('[大体积混凝土配合比计算] 结果:', {
      Q0: Q0.toFixed(2),
      flyAshRatio: flyAshRatio.toFixed(2) + '%',
      slagRatio: slagRatio.toFixed(2) + '%',
      k1: k1.toFixed(4),
      k2: k2.toFixed(4),
      k: k.toFixed(4),
      totalHeat: totalHeat.toFixed(2),
      waterContent: waterContent.toFixed(2),
      sandContent: sandContent.toFixed(2),
      stoneContent: stoneContent.toFixed(2)
    })

    return {
      strengthGrade,
      cementType,
      cementContent,
      flyAshContent,
      slagContent,
      totalBinder,
      cementHeat3d,
      cementHeat7d,
      Q0,
      flyAshRatio,
      slagRatio,
      k1,
      k2,
      k,
      totalHeat,
      waterBinderRatio,
      waterContent,
      sandRatio,
      sandContent,
      stoneContent,
      admixtureContent
    }
  }

  /**
   * 保存配合比设计结果
   * @param {number} schemeId - 方案ID
   * @param {Object} data - 配合比数据
   * @returns {Promise<Object>} 保存后的数据
   */
  async saveMixDesign(schemeId, data) {
    try {
      // 查找是否已存在该方案的配合比记录
      let mixDesign = await MassConcreteMixDesign.findOne({ where: { schemeId } })

      if (mixDesign) {
        // 更新现有记录
        await mixDesign.update(data)
        console.log('[配合比保存] 更新方案' + schemeId + '的配合比成功')
        return mixDesign.toJSON()
      } else {
        // 创建新记录
        mixDesign = await MassConcreteMixDesign.create({
          schemeId,
          ...data
        })
        console.log('[配合比保存] 新增方案' + schemeId + '的配合比成功')
        return mixDesign.toJSON()
      }
    } catch (error) {
      console.error('[配合比保存] 保存配合比失败:', error)
      throw error
    }
  }

  /**
   * 从已有配合比导入
   * @param {number} mixDesignId - 源配合比ID
   * @returns {Promise<Object>} 导入的配合比数据
   */
  async importFromMixDesign(mixDesignId) {
    try {
      const sourceMixDesign = await MassConcreteMixDesign.findByPk(mixDesignId)
      if (!sourceMixDesign) {
        throw new Error('指定的配合比不存在')
      }
      console.log('[配合比导入] 从ID=' + mixDesignId + '导入配合比')
      return sourceMixDesign.toJSON()
    } catch (error) {
      console.error('[配合比导入] 导入配合比失败:', error)
      throw error
    }
  }

  /**
   * 获取方案的配合比
   * @param {number} schemeId - 方案ID
   * @returns {Promise<Object|null>}
   */
  async getMixDesignBySchemeId(schemeId) {
    try {
      const mixDesign = await MassConcreteMixDesign.findOne({ where: { schemeId } })
      return mixDesign ? mixDesign.toJSON() : null
    } catch (error) {
      console.error('[配合比获取] 获取配合比失败:', error)
      throw error
    }
  }
}

module.exports = new MassConcreteMixDesignService()