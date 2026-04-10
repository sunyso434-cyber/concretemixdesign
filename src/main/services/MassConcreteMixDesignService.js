const MassConcreteMixDesign = require('../db/models/MassConcreteMixDesign')
const MixDesignService = require('./MixDesignService')
const fs = require('fs')
const path = require('path')

/**
 * 大体积混凝土配合比设计服务
 * 基于 GB 50496-2018《大体积混凝土施工标准》
 */
class MassConcreteMixDesignService {
  // 大体积混凝土限值（GB 50496-2018）
  static LIMITS = {
    maxWaterBinderRatio: 0.45,   // 水胶比不宜大于0.45
    maxWater: 170,                 // 拌合水不宜大于170 kg/m³
    minBinder: 260                // 最小胶凝材料用量 >= 260 kg/m³
  }

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
   * 大体积混凝土限值检查与边界值修正
   * 基于 GB 50496-2018：
   * - 水胶比不宜大于0.45
   * - 拌合水不宜大于170 kg/m³
   * - 最小胶凝材料用量 >= 260 kg/m³
   * @param {Object} mixResult - MixDesignService 返回的配合比结果
   * @returns {Object} 修正后的结果，包含限值检查信息
   */
  /**
   * 应用大体积混凝土限值
   * 限值检查顺序：
   * 1. 水胶比 > 限值 → 采用限值，重算胶凝材料 = 用水量 / 限值水胶比
   * 2. 用水量 > 限值 → 采用限值，重算胶凝材料 = 用水量 / 当前水胶比
   * 3. 胶凝材料 < 限值 → 采用限值，重算水胶比 = 用水量 / 限值胶凝材料
   *
   * @param {Object} mixResult - MixDesignService 返回的配合比结果
   * @returns {Object} 应用限值后的结果
   */
  applyLimits(mixResult) {
    const limits = MassConcreteMixDesignService.LIMITS
    const limitChecks = []

    // 从通用计算结果中提取关键值
    // 通用计算流程：用水量由骨料/坍落度决定 → 胶凝材料 = 用水量/水胶比 → 水胶比由强度决定
    let waterAmount = mixResult.materials.water
    let waterBinderRatio = mixResult.waterRatio
    let cementitiousAmount = (mixResult.materials.cement || 0) +
                             (mixResult.materials.flyAsh || 0) +
                             (mixResult.materials.slag || 0)

    // 记录原始计算值
    const originalWaterBinderRatio = waterBinderRatio
    const originalWaterAmount = waterAmount
    const originalCementitiousAmount = cementitiousAmount

    // 限值应用：按顺序迭代直到所有限值满足
    const maxIter = 20
    for (let i = 0; i < maxIter; i++) {
      let limitApplied = false

      // 1. 水胶比检查：不宜大于0.45
      if (waterBinderRatio > limits.maxWaterBinderRatio) {
        // 采用水胶比限值，重算胶凝材料 = 用水量 / 限值水胶比
        waterBinderRatio = limits.maxWaterBinderRatio
        cementitiousAmount = waterAmount / waterBinderRatio
        limitApplied = true
        console.log(`[限值调整] 水胶比${originalWaterBinderRatio.toFixed(3)}>${limits.maxWaterBinderRatio}，已按边界值${waterBinderRatio}计算，胶凝材料调整为${cementitiousAmount.toFixed(1)}`)
      }

      // 2. 用水量检查：不宜大于170 kg/m³
      if (waterAmount > limits.maxWater) {
        // 采用用水量限值，重算胶凝材料 = 用水量 / 当前水胶比
        waterAmount = limits.maxWater
        cementitiousAmount = waterAmount / waterBinderRatio
        limitApplied = true
        console.log(`[限值调整] 用水量${originalWaterAmount.toFixed(1)}>${limits.maxWater}，已按边界值${waterAmount}计算，胶凝材料调整为${cementitiousAmount.toFixed(1)}`)
      }

      // 3. 胶凝材料检查：不宜小于260 kg/m³
      if (cementitiousAmount < limits.minBinder) {
        // 采用胶凝材料限值，重算水胶比 = 用水量 / 限值胶凝材料
        cementitiousAmount = limits.minBinder
        waterBinderRatio = waterAmount / cementitiousAmount
        limitApplied = true
        console.log(`[限值调整] 胶凝材料${originalCementitiousAmount.toFixed(1)}<${limits.minBinder}，已按边界值${cementitiousAmount}计算，水胶比调整为${waterBinderRatio.toFixed(3)}`)
      }

      if (!limitApplied) break
    }

    // 记录限值检查结果
    limitChecks.push({
      item: '水胶比',
      limit: `≤ ${limits.maxWaterBinderRatio}`,
      actual: originalWaterBinderRatio.toFixed(3),
      adjusted: originalWaterBinderRatio !== waterBinderRatio,
      final: waterBinderRatio.toFixed(3)
    })
    limitChecks.push({
      item: '用水量',
      limit: `≤ ${limits.maxWater} kg/m³`,
      actual: originalWaterAmount.toFixed(1),
      adjusted: originalWaterAmount !== waterAmount,
      final: waterAmount.toFixed(1)
    })
    limitChecks.push({
      item: '胶凝材料',
      limit: `≥ ${limits.minBinder} kg/m³`,
      actual: originalCementitiousAmount.toFixed(1),
      adjusted: originalCementitiousAmount !== cementitiousAmount,
      final: cementitiousAmount.toFixed(1)
    })

    // 按原始配合比比例重新分配胶凝材料各组分
    const origBinder = originalCementitiousAmount
    const cementRatio = origBinder > 0 ? (mixResult.materials.cement || 0) / origBinder : 0.7
    const flyAshRatio = origBinder > 0 ? ((mixResult.materials.flyAsh || 0) / origBinder) : 0.2
    const slagRatio = origBinder > 0 ? ((mixResult.materials.slag || 0) / origBinder) : 0.1

    // 重新计算胶凝材料各组分
    const newCement = cementitiousAmount * cementRatio
    const newFlyAsh = cementitiousAmount * flyAshRatio
    const newSlag = cementitiousAmount * slagRatio
    const newSuperplasticizer = mixResult.materials.superplasticizer || 0

    // 获取材料密度
    const materials = mixResult.materials._materials || mixResult.materials
    const cementDensity = materials?.cement?.density || 3.15
    const flyAshDensity = materials?.flyAsh?.density || 2.20
    const slagDensity = materials?.slag?.density || 2.90
    const spDensity = materials?.superplasticizer?.density || 1.05
    const sandDensity = materials?.sand?.density || (Array.isArray(materials?.sand) ? materials.sand[0]?.density : 2.63) || 2.63
    const stoneDensity = materials?.stone?.density || (Array.isArray(materials?.stone) ? materials.stone[0]?.density : 2.70) || 2.70

    // 确保 sandRatio 是小数形式（0-1 之间）
    let sandRatio = mixResult.sandRatio
    if (sandRatio > 1) {
      sandRatio = sandRatio / 100
    }

    const airContent = mixResult.airContent || 1.0
    const targetDensity = mixResult.targetDensity || 2400
    const calculationMethod = mixResult.calculationMethod || 'absolute'

    console.log('[applyLimits] 调试信息:', {
      waterAmount,
      waterBinderRatio,
      cementitiousAmount,
      cementDensity,
      flyAshDensity,
      slagDensity,
      spDensity,
      sandDensity,
      stoneDensity,
      sandRatio,
      airContent,
      targetDensity,
      calculationMethod
    })

    // 写日志到文件
    const logPath = path.join(process.env.APPDATA || process.env.HOME || '.', 'mc_debug.log')
    const logContent = `[${new Date().toISOString()}] applyLimits 调试:\n` +
      `waterAmount=${waterAmount}, waterBinderRatio=${waterBinderRatio}, cementitiousAmount=${cementitiousAmount}\n` +
      `cementDensity=${cementDensity}, sandDensity=${sandDensity}, stoneDensity=${stoneDensity}\n` +
      `sandRatio=${sandRatio}, airContent=${airContent}, targetDensity=${targetDensity}\n` +
      `calculationMethod=${calculationMethod}\n` +
      `mixResult.sandRatio=${mixResult.sandRatio}, mixResult.waterRatio=${mixResult.waterRatio}\n` +
      `mixResult.materials.water=${mixResult.materials.water}, mixResult.materials.cement=${mixResult.materials.cement}\n\n`
    fs.appendFileSync(logPath, logContent)

    let newSand, newStone, actualDensity

    fs.appendFileSync(logPath, `[${new Date().toISOString()}] 限值调整后: newCement=${newCement}, newFlyAsh=${newFlyAsh}, newSlag=${newSlag}\n`)

    // 检查是否有多种细骨料（通过 sand_${id} 属性判断）
    const sandKeys = Object.keys(mixResult.materials).filter(k => k.startsWith('sand_'))
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] 多种砂检测: sandKeys=${JSON.stringify(sandKeys)}\n`)

    if (calculationMethod === 'mass') {
      // 质量法：骨料总量 = 目标容重 - 胶凝材料 - 水 - 外加剂
      const aggregateAmount = targetDensity - waterAmount - newCement - newFlyAsh - newSlag - newSuperplasticizer
      newSand = aggregateAmount * sandRatio
      newStone = aggregateAmount * (1 - sandRatio)
      actualDensity = waterAmount + newCement + newFlyAsh + newSlag + newSand + newStone + newSuperplasticizer
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] 质量法: aggregateAmount=${aggregateAmount}, newSand=${newSand}, newStone=${newStone}\n`)
    } else {
      // 绝对体积法：基于材料密度重新计算体积
      // 注意：质量(kg/m³) / (密度(g/cm³) × 1000) = 体积(m³)
      const toM3 = (kgPerM3, gPerCm3) => kgPerM3 / (gPerCm3 * 1000)

      const cementVol = toM3(newCement, cementDensity)
      const flyAshVol = toM3(newFlyAsh, flyAshDensity)
      const slagVol = toM3(newSlag, slagDensity)
      const waterVol = toM3(waterAmount, 1.0) // 水密度 1.0 g/cm³
      const spVol = toM3(newSuperplasticizer, spDensity)
      const airVol = airContent / 100

      fs.appendFileSync(logPath, `[${new Date().toISOString()}] 体积法: cementVol=${cementVol}, flyAshVol=${flyAshVol}, slagVol=${slagVol}, waterVol=${waterVol}, spVol=${spVol}, airVol=${airVol}\n`)

      // 骨料体积 = 1 - 胶凝材料体积 - 水体积 - 外加剂体积 - 空气体积
      const aggregateVolume = 1 - cementVol - flyAshVol - slagVol - waterVol - spVol - airVol

      fs.appendFileSync(logPath, `[${new Date().toISOString()}] 体积法: aggregateVolume=${aggregateVolume}\n`)

      // 密度单位是 g/cm³，需要 × 1000 转换为 kg/m³
      newSand = aggregateVolume * sandRatio * sandDensity * 1000
      newStone = aggregateVolume * (1 - sandRatio) * stoneDensity * 1000

      // 计算实际容重
      actualDensity = newCement + newFlyAsh + newSlag + newSand + newStone + waterAmount + newSuperplasticizer

      fs.appendFileSync(logPath, `[${new Date().toISOString()}] 体积法: newSand=${newSand}, newStone=${newStone}, actualDensity=${actualDensity}\n`)
    }

    // 构建新材料对象，如果有多种砂，按原始比例分配
    const newMaterials = {
      ...mixResult.materials,
      water: waterAmount,
      cement: newCement,
      flyAsh: newFlyAsh,
      slag: newSlag,
      sand: newSand,
      stone: newStone,
      superplasticizer: newSuperplasticizer
    }

    // 如果有多种细骨料，按原始比例重新分配每种砂的用量
    if (sandKeys.length > 0) {
      const origTotalSand = sandKeys.reduce((sum, k) => sum + (mixResult.materials[k] || 0), 0)
      sandKeys.forEach(k => {
        const origRatio = origTotalSand > 0 ? (mixResult.materials[k] || 0) / origTotalSand : 1 / sandKeys.length
        newMaterials[k] = newSand * origRatio
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] 多种砂分配: ${k} = ${newMaterials[k]}\n`)
      })

      // 同时更新 fineAggregateBreakdown 中的用量
      if (mixResult.fineAggregateBreakdown && mixResult.fineAggregateBreakdown.length > 0) {
        mixResult.fineAggregateBreakdown.forEach(item => {
          const key = `sand_${item.id}`
          if (newMaterials[key] !== undefined) {
            item.amount = newMaterials[key]
          }
        })
      }
    }

    return {
      ...mixResult,
      waterRatio: waterBinderRatio,
      materials: newMaterials,
      density: actualDensity,
      limitChecks,
      adjusted: limitChecks.some(c => c.adjusted)
    }
  }

  /**
   * 计算水化热影响系数
   * @param {number} cementContent - 水泥用量 kg/m³
   * @param {number} flyAshContent - 粉煤灰用量 kg/m³
   * @param {number} slagContent - 矿渣粉用量 kg/m³
   * @param {number} cementHeat3d - 水泥3d水化热 kJ/kg
   * @param {number} cementHeat7d - 水泥7d水化热 kJ/kg
   * @returns {Object} 水化热计算结果
   */
  calculateHydrationHeat(cementContent, flyAshContent, slagContent, cementHeat3d, cementHeat7d) {
    // 计算 Q0 = 4 / (7/Q7 - 3/Q3)
    const Q0 = 4 / (7 / cementHeat7d - 3 / cementHeat3d)

    // 计算粉煤灰和矿渣粉的掺量比例
    const totalBinder = cementContent + flyAshContent + slagContent
    const flyAshRatio = totalBinder > 0 ? (flyAshContent / totalBinder) * 100 : 0
    const slagRatio = totalBinder > 0 ? (slagContent / totalBinder) * 100 : 0

    // 根据掺量比例查表插值计算 k1, k2
    const k1 = MassConcreteMixDesignService.interpolateK(flyAshRatio, MassConcreteMixDesignService.FLY_ASH_K1)
    const k2 = MassConcreteMixDesignService.interpolateK(slagRatio, MassConcreteMixDesignService.SLAG_K2)

    // 综合影响系数
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

    // 总发热量 Q = k * Q0
    const totalHeat = k * Q0

    return {
      Q0,
      flyAshRatio,
      slagRatio,
      k1,
      k2,
      k,
      totalHeat
    }
  }

  /**
   * 计算配合比设计
   * 先调用通用配合比计算，再应用大体积混凝土限值
   * @param {Object} params - 计算参数（传递给 MixDesignService）
   * @returns {Object} 计算结果
   */
  async calculate(params) {
    const {
      cementHeat3d,
      cementHeat7d,
      ...restParams
    } = params

    // 1. 调用通用配合比设计
    const mixResult = await MixDesignService.calculateMixDesign(restParams)

    // 2. 应用大体积混凝土限值
    const limitedResult = this.applyLimits(mixResult)

    // 3. 计算水化热（如果提供了水化热参数）
    let hydrationHeat = null
    if (cementHeat3d && cementHeat7d) {
      hydrationHeat = this.calculateHydrationHeat(
        limitedResult.materials.cement,
        limitedResult.materials.flyAsh || 0,
        limitedResult.materials.slag || 0,
        cementHeat3d,
        cementHeat7d
      )
    }

    // 4. 组装最终结果
    return {
      // 通用配合比结果
      ...limitedResult,
      // 大体积混凝土水化热
      hydrationHeat,
      // 原始参数（用于调试）
      inputParams: {
        cementHeat3d,
        cementHeat7d,
        ...restParams
      }
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