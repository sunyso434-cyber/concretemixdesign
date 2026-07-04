const MixDesignService_Strength = require('./MixDesignService_Strength')
const MixDesignService_WaterRatio = require('./MixDesignService_WaterRatio')

class MixDesignService_Aggregate {
  // 将价格值规范为数字（元/吨），兼容字符串带单位或空值
  toNumber(value) {
    if (value === undefined || value === null) return 0
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const parsed = parseFloat(String(value).replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }

  /**
   * 由各级筛孔累计筛余计算细度模数（JGJ 52-2006）
   * 与前端 materialFieldsConfig.calculateFinenessModulus 保持一致
   */
  finenessModulusFromCumulativeRetained(combinedSieve) {
    const get = (k) => parseFloat(combinedSieve && combinedSieve[k]) || 0
    const a1 = get('sieve_4_75')
    const a2 = get('sieve_2_36')
    const a3 = get('sieve_1_18')
    const a4 = get('sieve_0_60')
    const a5 = get('sieve_0_30')
    const a6 = get('sieve_0_15')
    const denominator = 100 - a1
    if (denominator === 0) return 0
    return (a2 + a3 + a4 + a5 + a6 - 5 * a1) / denominator
  }

  // 从粗骨料规格中提取最大粒径
  extractMaxAggregateSize(specification) {
    if (!specification) return 20 // 默认值

    const match = specification.match(/(\d+)-(\d+)mm/)
    if (match) {
      return parseInt(match[2])
    }

    const singleMatch = specification.match(/(\d+)mm/)
    if (singleMatch) {
      return parseInt(singleMatch[1])
    }

    return 20 // 默认值
  }

  /**
   * 粗骨料预选：按粒径选最大，同粒径选最便宜
   * @param {Array} stoneCandidates - 粗骨料候选
   * @returns {Object} 选中的粗骨料
   */
  preselectCoarseAggregate(stoneCandidates) {
    if (!Array.isArray(stoneCandidates) || stoneCandidates.length === 0) {
      throw new Error('粗骨料候选为空')
    }
    const withSize = stoneCandidates.map(s => ({
      ...s,
      _maxSize: this.extractMaxAggregateSize(s.specification)
    }))
    const maxSize = Math.max(...withSize.map(s => s._maxSize))
    return withSize
      .filter(s => s._maxSize === maxSize)
      .reduce((min, s) => (s.price || 0) < (min.price || 0) ? s : min)
  }

  /**
   * 目标细度模数（按强度等级查经验公式）
   * @param {string} strength - 强度等级，如 'C30'
   * @returns {number} 目标细度模数
   */
  targetFinenessModulusByStrength(strength) {
    const c = parseInt(String(strength).replace('C', ''))
    if (c <= 25) return 2.6
    if (c <= 35) return 2.8
    if (c <= 50) return 3.0
    if (c <= 60) return 3.2
    return 3.4
  }

  // 计算多种细骨料的最佳比例，使组合后的细度模数最接近目标值
  // targetFinenessModulus: 可选，默认为2.7
  calculateOptimalFineAggregateRatio(fineAggregates, targetFinenessModulus = 2.7) {
    if (!Array.isArray(fineAggregates) || fineAggregates.length <= 1) {
      const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
      // attach combined metrics for compatibility
      result.combinedFinenessModulus = fineAggregates.length === 1 ? (fineAggregates[0].finenessModulus || targetFinenessModulus) : targetFinenessModulus
      result.combinedMbValue = fineAggregates.length === 1 ? (fineAggregates[0].mbValue || 0.5) : 0.5
      return result
    }

    // 注意：targetFinenessModulus 由调用方提供（或使用默认2.7）

    // 判断是否所有细骨料都具备详细的筛余累计百分数（用于按筛余合成级配）
    const sieveKeys = ['sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15'];
    const hasDetailedSieve = fineAggregates.every(agg => {
      return sieveKeys.every(k => {
        const v = agg && agg[k];
        const n = parseFloat(v);
        return Number.isFinite(n);
      });
    });

    // 当只有两种细骨料且没有详细筛余数据时，使用解析解精确计算比例
    if (fineAggregates.length === 2 && !hasDetailedSieve) {
      const fm1 = parseFloat(fineAggregates[0].finenessModulus) || targetFinenessModulus;
      const fm2 = parseFloat(fineAggregates[1].finenessModulus) || targetFinenessModulus;

      let r1;
      // 使用解析解公式：r1 = (targetFM - fm2) / (fm1 - fm2)
      if (fm1 !== fm2) {
        r1 = (targetFinenessModulus - fm2) / (fm1 - fm2);
        // 限制比例在 [0, 1] 范围内
        r1 = Math.max(0, Math.min(1, r1));
      } else {
        // 两种砂细度模数相同，返回等比例
        r1 = 0.5;
      }

      const r2 = 1 - r1;
      const combinedMbValue = (fineAggregates[0].mbValue || 0.5) * r1 + (fineAggregates[1].mbValue || 0.5) * r2;

      const result = [
        { aggregate: fineAggregates[0], ratio: r1 },
        { aggregate: fineAggregates[1], ratio: r2 }
      ];
      result.combinedFinenessModulus = fm1 * r1 + fm2 * r2;
      result.combinedMbValue = combinedMbValue;
      console.log('[细骨料比例计算] 使用解析解，targetFM=' + targetFinenessModulus + ', fm1=' + fm1 + ', fm2=' + fm2 + ', r1=' + r1.toFixed(6) + ', r2=' + r2.toFixed(6));
      return result;
    }

    // 对于三种及以上细骨料，或有详细筛余数据的情况，使用搜索算法
    const steps = fineAggregates.length === 2 ? 100 : 10; // 两种砂时使用更高精度
    let bestCombination = null;
    let minDifference = Infinity;

    console.log('[细骨料比例计算] 使用搜索算法，fineAggregates.length=' + fineAggregates.length + ', hasDetailedSieve=' + hasDetailedSieve);

    // 递归生成所有可能的比例组合
    const generateCombinations = (index, currentRatios) => {
      if (index === fineAggregates.length - 1) {
        // 最后一个骨料的比例由前面的比例决定
        const remainingRatio = 1 - currentRatios.reduce((sum, ratio) => sum + ratio, 0)
        if (remainingRatio < 0 || remainingRatio > 1) return

        const ratios = [...currentRatios, remainingRatio]

        // 计算组合后的细度模数
        let combinedFinenessModulus = 0
        let combinedMbValue = 0

        if (hasDetailedSieve) {
          // 使用每种砂的筛余累计百分数按比例合成后计算细度模数
          const combinedSieve = {}
          for (const key of sieveKeys) combinedSieve[key] = 0

          for (let i = 0; i < fineAggregates.length; i++) {
            const aggregate = fineAggregates[i]
            const ratio = ratios[i]
            for (const key of sieveKeys) {
              const v = parseFloat(aggregate[key]) || 0
              combinedSieve[key] += v * ratio
            }
            combinedMbValue += (aggregate.mbValue || 0.5) * ratio
          }

          combinedFinenessModulus = this.finenessModulusFromCumulativeRetained(combinedSieve)
        } else {
          // 回退：按各砂的细度模数加权平均
          for (let i = 0; i < fineAggregates.length; i++) {
            const aggregate = fineAggregates[i]
            const ratio = ratios[i]
            combinedFinenessModulus += (aggregate.finenessModulus || targetFinenessModulus) * ratio
            combinedMbValue += (aggregate.mbValue || 0.5) * ratio
          }
        }

        // 计算与目标细度模数的差异
        const difference = Math.abs(combinedFinenessModulus - targetFinenessModulus)

        if (difference < minDifference) {
          minDifference = difference
          bestCombination = {
            ratios,
            combinedFinenessModulus,
            combinedMbValue
          }
        }

        return
      }

      // 为当前骨料生成可能的比例
      for (let i = 0; i <= steps; i++) {
        const ratio = i / steps
        // 确保剩余的比例足够分配给其他骨料
        const remainingRatio = 1 - currentRatios.reduce((sum, r) => sum + r, 0) - ratio
        if (remainingRatio >= 0) {
          generateCombinations(index + 1, [...currentRatios, ratio])
        }
      }
    }

    // 开始生成组合
    generateCombinations(0, [])

    if (bestCombination) {
      const result = fineAggregates.map((aggregate, index) => ({
        aggregate,
        ratio: bestCombination.ratios[index]
      }))
      // attach computed metrics for callers
      result.combinedFinenessModulus = bestCombination.combinedFinenessModulus
      result.combinedMbValue = bestCombination.combinedMbValue
      return result
    }

    // 如果没有找到最佳组合，返回等比例
    const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
    // compute combined metrics for equal distribution
    const combinedFm = fineAggregates.reduce((s, agg) => s + ((agg.finenessModulus || targetFinenessModulus) * (1 / fineAggregates.length)), 0)
    const combinedMb = fineAggregates.reduce((s, agg) => s + ((agg.mbValue || 0.5) * (1 / fineAggregates.length)), 0)
    result.combinedFinenessModulus = combinedFm
    result.combinedMbValue = combinedMb
    return result
  }

  // 计算组合后的细骨料参数
  // targetFinenessModulus: 可选，传入目标细度模数以影响最佳配比计算
  calculateCombinedFineAggregateParams(fineAggregates, targetFinenessModulus = 2.7) {
    if (!Array.isArray(fineAggregates)) {
      return {
        finenessModulus: fineAggregates?.finenessModulus || targetFinenessModulus,
        mbValue: fineAggregates?.mbValue || 0.5
      }
    }

    if (fineAggregates.length === 1) {
      return {
        finenessModulus: fineAggregates[0].finenessModulus || targetFinenessModulus,
        mbValue: fineAggregates[0].mbValue || 0.5
      }
    }

    // 计算最佳比例（使用传入的目标细度模数）
    const optimalRatio = this.calculateOptimalFineAggregateRatio(fineAggregates, targetFinenessModulus)

    // 如果optimalRatio携带已计算的组合细度模数（由筛余累计合成），直接使用
    let combinedFinenessModulus = optimalRatio.combinedFinenessModulus
    let combinedMbValue = optimalRatio.combinedMbValue

    // 否则回退到按细度模数和MB值加权平均
    if (combinedFinenessModulus === undefined || combinedMbValue === undefined) {
      combinedFinenessModulus = 0
      combinedMbValue = 0
      for (const item of optimalRatio) {
        combinedFinenessModulus += (item.aggregate.finenessModulus || targetFinenessModulus) * item.ratio
        combinedMbValue += (item.aggregate.mbValue || 0.5) * item.ratio
      }
    }

    return {
      finenessModulus: combinedFinenessModulus,
      mbValue: combinedMbValue,
      optimalRatio
    }
  }

  // 获取基准用水量（根据最大粒径和坍落度）
  getBaseWaterAmount(maxSize, slump, aggregateType = '碎石') {
    // JGJ 55-2011表5.2.1-2 塑性混凝土的用水量
    const waterTable = {
      '卵石': {
        10: [190, 200, 210, 215],  // 10-30, 35-50, 55-70, 75-90
        20: [170, 180, 190, 195],
        31.5: [160, 170, 180, 185],
        40: [150, 160, 170, 175]
      },
      '碎石': {
        16: [200, 210, 220, 230],
        20: [185, 195, 205, 215],
        31.5: [175, 185, 195, 205],
        40: [165, 175, 185, 195]
      }
    }

    // 找到最接近的粒径
    const sizes = Object.keys(waterTable[aggregateType]).map(Number).sort((a, b) => a - b)
    let closestSize = sizes[0]
    for (const size of sizes) {
      if (maxSize >= size) {
        closestSize = size
      }
    }

    // 确定坍落度对应的用水量范围
    let baseWaterAmount
    if (slump <= 30) {
      baseWaterAmount = waterTable[aggregateType][closestSize][0]
    } else if (slump <= 50) {
      baseWaterAmount = waterTable[aggregateType][closestSize][1]
    } else if (slump <= 70) {
      baseWaterAmount = waterTable[aggregateType][closestSize][2]
    } else if (slump <= 90) {
      baseWaterAmount = waterTable[aggregateType][closestSize][3]
    } else {
      // 坍落度大于90mm时，按每增大20mm增加5kg/m³用水量
      const slumpIncrease = slump - 90
      const waterIncrease = Math.floor(slumpIncrease / 20) * 5
      baseWaterAmount = waterTable[aggregateType][closestSize][3] + waterIncrease

      // 当坍落度超过180mm时，减少增加量
      if (slump > 180) {
        const extraSlump = slump - 180
        const extraWaterIncrease = Math.floor(extraSlump / 20) * 3 // 超过180mm后每20mm增加3kg
        baseWaterAmount = waterTable[aggregateType][closestSize][3] + Math.floor((180 - 90) / 20) * 5 + extraWaterIncrease
      }
    }

    return baseWaterAmount
  }

  // 计算减水剂掺量（多因素调整）
  async calculateSuperplasticizerDosage(strength, fineAggregateMaterial, tempSettings = null) {
    try {
      // 步骤1：获取基准掺量（原材料推荐掺量）
      // 假设原材料信息中推荐掺量为1.5%（实际应从原材料获取）
      let baseDosage = 1.5

      // 步骤2：强度等级调整（先调整强度等级）
      const strengthDosage = await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength(strength, tempSettings)
      let finalDosage = strengthDosage

      // 步骤3：根据细骨料MB值和细度模数调整
      let mbAdjustment = 0
      let fmAdjustment = 0

      if (fineAggregateMaterial) {
        // 根据强度等级计算目标细度模数并用于组合计算
        const targetFinenessModulus = MixDesignService_Strength.computeTargetFinenessModulus(strength, tempSettings)
        // 计算组合后的细骨料参数（使用目标细度模数）
        const combinedParams = this.calculateCombinedFineAggregateParams(fineAggregateMaterial, targetFinenessModulus)

        const baseMbValue = 0.5 // 基准MB值
        const baseFinenessModulus = targetFinenessModulus // 基准细度模数使用目标值

        const mbValue = combinedParams.mbValue
        const finenessModulus = combinedParams.finenessModulus

        // 获取高级设置中的影响参数，默认为0.1%
        const mbInfluence = tempSettings?.mbInfluence || 0.1
        const finenessInfluence = tempSettings?.finenessInfluence || 0.1

        // MB值调整：每增大0.1，掺量增加；每减少0.1，掺量减少
        mbAdjustment = ((mbValue - baseMbValue) / 0.1) * mbInfluence

        // 细度模数调整：每增加0.1，掺量减少；每减少0.1，掺量增加
        fmAdjustment = ((baseFinenessModulus - finenessModulus) / 0.1) * finenessInfluence

        finalDosage += mbAdjustment + fmAdjustment

        console.log('减水剂掺量调整详情:', {
          baseDosage,
          strengthDosage,
          mbValue,
          mbAdjustment,
          finenessModulus,
          fmAdjustment,
          finalDosage,
          optimalRatio: combinedParams.optimalRatio
        })
      }

      return {
        finalDosage,
        strengthDosage, // 强度等级调整后的掺量
        baseDosage, // 基准掺量
        mbAdjustment, // MB值调整量
        fmAdjustment // 细度模数调整量
      }
    } catch (error) {
      console.error('计算减水剂掺量失败:', error)
      return {
        finalDosage: 1.5, // 默认值
        strengthDosage: 1.5,
        baseDosage: 1.5,
        mbAdjustment: 0,
        fmAdjustment: 0
      }
    }
  }

  // 计算减水率（基于强度等级调整的掺量变化）
  async calculateWaterReducingRate(baseReducingRate, baseDosage, strengthDosage, tempSettings = null) {
    try {
      const ratePer01 = await MixDesignService_WaterRatio.getWaterReducingRatePer01Dosage(tempSettings)
      const dosageDiff = strengthDosage - baseDosage // 只考虑强度等级调整的掺量变化
      const rateAdjustment = (dosageDiff / 0.1) * ratePer01
      const finalRate = baseReducingRate + rateAdjustment

      console.log('减水率调整详情:', {
        baseReducingRate,
        baseDosage,
        strengthDosage,
        ratePer01,
        rateAdjustment,
        finalRate
      })

      return finalRate
    } catch (error) {
      console.error('计算减水率失败:', error)
      return baseReducingRate
    }
  }

  // 绝对体积法计算
  // materialAmounts: 各材料用量 (kg/m³)，键名如 water, cement, sand, stone, superplasticizer, sand_1, sand_2, ...
  // materials: 材料对象，支持 sand/stone 为单一对象或数组
  // airContent: 含气量百分比（默认1%），传入如 1.5 表示1.5%
  calculateByAbsoluteVolume(materialAmounts, materials, airContent = 1.0) {
    try {
      const volumes = {}
      let totalVolume = 0

      // 根据 key 查找对应材料密度的辅助函数
      const getMaterialDensity = (key) => {
        // 直接从 materials 对象查找（适用于 water, cement, flyAsh, slag, superplasticizer）
        const direct = materials[key]
        if (direct && direct.density) return direct.density

        // 处理 sand_* 键（多种细骨料时）
        if (key.startsWith('sand_')) {
          const sandId = key.replace('sand_', '')
          const sandArr = Array.isArray(materials.sand) ? materials.sand : []
          const found = sandArr.find(s => String(s.id) === String(sandId))
          return found?.density || 2.63
        }
        // 处理 stone_* 键（多种粗骨料时）
        if (key.startsWith('stone_')) {
          const stoneId = key.replace('stone_', '')
          const stoneArr = Array.isArray(materials.stone) ? materials.stone : []
          const found = stoneArr.find(s => String(s.id) === String(stoneId))
          return found?.density || 2.70
        }
        // 单一砂或单一石的聚合键（sand, stone）
        if (key === 'sand') {
          if (Array.isArray(materials.sand)) return materials.sand[0]?.density || 2.63
          return materials.sand?.density || 2.63
        }
        if (key === 'stone') {
          if (Array.isArray(materials.stone)) return materials.stone[0]?.density || 2.70
          return materials.stone?.density || 2.70
        }
        return null
      }

      // 计算每种材料的绝对体积
      Object.keys(materialAmounts).forEach((key) => {
        const amount = materialAmounts[key]
        if (amount === undefined || amount === null) {
          volumes[key] = 0
          return
        }
        const density = getMaterialDensity(key)
        if (density && density > 0) {
          const volume = amount / density
          volumes[key] = volume
          totalVolume += volume
        } else {
          volumes[key] = 0
        }
      })

      // 空气体积 = 含气量百分比 / 100
      const airVolume = airContent / 100
      totalVolume += airVolume

      console.log('绝对体积法计算 volumes:', volumes)

      // 计算骨料（sand + stone）的当前体积和目标体积
      // 累加所有 sand_* 和 stone_* 键的体积（多种骨料情况）
      let currentSandVolume = 0
      let currentStoneVolume = 0
      Object.keys(volumes).forEach((key) => {
        if (key.startsWith('sand_') || key === 'sand') currentSandVolume += volumes[key] || 0
        if (key.startsWith('stone_') || key === 'stone') currentStoneVolume += volumes[key] || 0
      })
      const currentAggregateVolume = currentSandVolume + currentStoneVolume

      // 目标骨料体积 = 1 - 胶凝材料体积 - 水体积 - 外加剂体积 - 空气体积
      const cementVol = volumes.cement || 0
      const flyAshVol = volumes.flyAsh || 0
      const slagVol = volumes.slag || 0
      const waterVol = volumes.water || 0
      const spVol = volumes.superplasticizer || 0
      const targetAggregateVolume = 1 - cementVol - flyAshVol - slagVol - waterVol - spVol - airVolume

      // 缩放比例：骨料需要缩放到的比例
      const scaleFactor = currentAggregateVolume > 0 && targetAggregateVolume > 0
        ? targetAggregateVolume / currentAggregateVolume
        : 1

      console.log('绝对体积法:', {
        currentAggregateVolume,
        targetAggregateVolume,
        scaleFactor,
        cementVol, flyAshVol, slagVol, waterVol, spVol, airVolume
      })

      return {
        volumes,
        totalVolume,
        airVolume,
        currentAggregateVolume,
        targetAggregateVolume,
        scaleFactor
      }
    } catch (error) {
      console.error('绝对体积法计算失败:', error)
      return null
    }
  }

  // 质量法计算
  calculateByMassMethod(materialAmounts, targetDensity = 2400) {
    try {
      // 计算当前总质量
      const currentDensity = Object.values(materialAmounts).reduce((sum, amount) => sum + amount, 0)

      // 计算缩放比例
      const scaleFactor = targetDensity / currentDensity

      // 缩放所有材料用量
      const scaledMaterialAmounts = {}
      Object.keys(materialAmounts).forEach((key) => {
        scaledMaterialAmounts[key] = materialAmounts[key] * scaleFactor
      })

      const finalDensity = Object.values(scaledMaterialAmounts).reduce((sum, amount) => sum + amount, 0)

      console.log('质量法计算:', {
        currentDensity,
        targetDensity,
        scaleFactor,
        finalDensity
      })

      return {
        materialAmounts: scaledMaterialAmounts,
        targetDensity,
        finalDensity,
        scaleFactor
      }
    } catch (error) {
      console.error('质量法计算失败:', error)
      return null
    }
  }

  // 计算用水量
  calculateWaterAmount(slump) {
    // 简化计算，实际应根据骨料类型和坍落度计算
    if (slump <= 40) {
      return 160
    } else if (slump <= 80) {
      return 170
    } else if (slump <= 120) {
      return 180
    } else if (slump <= 160) {
      return 190
    } else {
      return 200
    }
  }

  /**
   * 计算砂率（基于JGJ 55-2011标准）
   * @param {number} waterRatio - 水胶比
   * @param {number} slump - 坍落度(mm)
   * @param {number} finenessModulus - 砂细度模数（默认2.8）
   * @param {string} aggregateType - 骨料类型，'gravel'碎石或'cobble'卵石（默认gravel）
   * @returns {number} 砂率（小数形式，如0.38表示38%）
   */
  calculateSandRatio(waterRatio, slump, finenessModulus = 2.8, aggregateType = 'gravel') {
    // JGJ 55-2011 碎石混凝土砂率表（简化公式）
    // 基准砂率37%（水胶比0.40，坍落度30-50mm，砂细度模数2.8）
    // 水胶比每增加0.05，砂率增加1%
    // 坍落度每增加20mm，砂率增加1%
    // 砂细度模数每增加0.1，砂率增加0.5%

    const baseSandRatio = 0.37 // 基准砂率37%
    const waterRatioEffect = (waterRatio - 0.40) * 0.2 // 水胶比影响，每增加0.05砂率增加1%
    const slumpEffect = ((slump - 60) / 20) * 0.01 // 坍落度影响，每增加20mm砂率增加1%
    const fmEffect = (finenessModulus - 2.8) * 0.05 // 细度模数每增加0.1砂率增加0.5%

    // 卵石混凝土砂率比碎石高约2-3%
    const aggregateBonus = aggregateType === 'cobble' ? 0.025 : 0

    let sandRatio = baseSandRatio + waterRatioEffect + slumpEffect + fmEffect + aggregateBonus

    // 限制在合理范围内
    sandRatio = Math.max(0.28, Math.min(0.50, sandRatio))

    return sandRatio
  }

  /**
   * 计算混凝土容重（kg/m³）
   * materialAmounts 中可能同时存在：
   *   - 'sand' / 'stone'：骨料总量
   *   - 'sand_<id>' / 'stone_<id>'：多种骨料时的细分用量（避免重复计入）
   * 算法：累加所有非细分键的值
   *
   * @param {Object} materialAmounts - 各材料用量（kg/m³）
   * @returns {number} 容重（kg/m³）
   */
  calculateDensity(materialAmounts) {
    if (!materialAmounts || typeof materialAmounts !== 'object') return 0
    const densityKeys = Object.keys(materialAmounts).filter(
      key => !key.startsWith('sand_') && !key.startsWith('stone_')
    )
    return densityKeys.reduce((sum, key) => sum + (Number(materialAmounts[key]) || 0), 0)
  }

  /**
   * 胶凝成本快速估算（阶段 2 用）
   * 仅算水泥+掺合料+减水剂成本，不算砂石
   * @param {Object} params
   * @returns {number} 胶凝成本（元/m³）
   */
  computeCementitiousCost({
    baseWaterAmount,
    waterRatio,
    flyAsh = 0, slag = 0, lithiumSlag = 0, compositePowder = 0,
    cementMat, flyAshMat, slagMat, lithiumSlagMat, compositePowderMat,
    spDosage, spMat
  }) {
    const cementitiousAmount = baseWaterAmount / waterRatio
    const cementAmount = cementitiousAmount * (1 - flyAsh/100 - slag/100 - lithiumSlag/100 - compositePowder/100)
    const flyAshAmount = cementitiousAmount * flyAsh / 100
    const slagAmount = cementitiousAmount * slag / 100
    const lithiumSlagAmount = cementitiousAmount * lithiumSlag / 100
    const compositePowderAmount = cementitiousAmount * compositePowder / 100
    const spAmount = cementitiousAmount * spDosage / 100

    const toCost = (kg, price) => price ? (kg * price / 1000) : 0
    return toCost(cementAmount, cementMat?.price)
         + toCost(flyAshAmount, flyAshMat?.price)
         + toCost(slagAmount, slagMat?.price)
         + toCost(lithiumSlagAmount, lithiumSlagMat?.price)
         + toCost(compositePowderAmount, compositePowderMat?.price)
         + toCost(spAmount, spMat?.price)
  }
}

module.exports = new MixDesignService_Aggregate()