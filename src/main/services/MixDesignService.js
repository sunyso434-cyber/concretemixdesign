const MixDesign = require('../db/models/MixDesign')
const MaterialService = require('./MaterialService')
const SystemService = require('./SystemService')

class MixDesignService {
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
  computeTargetFinenessModulus(strength, tempSettings = null) {
    try {
      // 优先使用临时设置中的基准细度模数
      const baseFm = (tempSettings && tempSettings.targetFinenessModulusBase !== undefined && tempSettings.targetFinenessModulusBase !== null)
        ? parseFloat(tempSettings.targetFinenessModulusBase)
        : 2.7

      const strengthNum = parseInt(String(strength || '').replace('C', '')) || 30

      // 以 C30 为基准，每增加 5MPa，细度模数增加 0.1（即每 1MPa 增加 0.02）
      const target = baseFm + (strengthNum - 30) * 0.02

      return Number(target.toFixed(2))
    } catch (error) {
      return 2.7
    }
  }

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

  // 将价格值规范为数字（元/吨），兼容字符串带单位或空值
  toNumber(value) {
    if (value === undefined || value === null) return 0
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const parsed = parseFloat(String(value).replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
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

          // 细度模数 = 各级筛余累计百分数之和 / 100
          const sieveSum = sieveKeys.reduce((s, k) => s + (combinedSieve[k] || 0), 0)
          combinedFinenessModulus = sieveSum / 100
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
      const strengthDosage = await this.getSuperplasticizerDosageByStrength(strength, tempSettings)
      let finalDosage = strengthDosage
      
      // 步骤3：根据细骨料MB值和细度模数调整
      let mbAdjustment = 0
      let fmAdjustment = 0
      
      if (fineAggregateMaterial) {
        // 根据强度等级计算目标细度模数并用于组合计算
        const targetFinenessModulus = this.computeTargetFinenessModulus(strength, tempSettings)
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
      const ratePer01 = await this.getWaterReducingRatePer01Dosage(tempSettings)
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

  // 绝对体积法计算
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

  // 获取所有配合比方案
  async getAllMixDesigns() {
    try {
      return await MixDesign.findAll()
    } catch (error) {
      console.error('获取配合比方案列表失败:', error)
      throw error
    }
  }

  // 根据ID获取配合比方案
  async getMixDesignById(id) {
    try {
      return await MixDesign.findByPk(id)
    } catch (error) {
      console.error('获取配合比方案详情失败:', error)
      throw error
    }
  }

  // 创建配合比方案
  async createMixDesign(data) {
    try {
      console.log('接收到的方案数据:', {
        hasMaterialDetails: !!data.materialDetails,
        hasMaterialCosts: !!data.materialCosts,
        hasTotalCost: !!data.totalCost,
        materialDetailsKeys: data.materialDetails ? Object.keys(data.materialDetails) : [],
        materialCostsKeys: data.materialCosts ? Object.keys(data.materialCosts) : []
      })
      
      return await MixDesign.create(data)
    } catch (error) {
      console.error('创建配合比方案失败:', error)
      throw error
    }
  }

  // 更新配合比方案
  async updateMixDesign(id, data) {
    try {
      const mixDesign = await MixDesign.findByPk(id)
      if (!mixDesign) {
        throw new Error('配合比方案不存在')
      }
      return await mixDesign.update(data)
    } catch (error) {
      console.error('更新配合比方案失败:', error)
      throw error
    }
  }

  // 删除配合比方案
  async deleteMixDesign(id) {
    try {
      const mixDesign = await MixDesign.findByPk(id)
      if (!mixDesign) {
        throw new Error('配合比方案不存在')
      }
      return await mixDesign.destroy()
    } catch (error) {
      console.error('删除配合比方案失败:', error)
      throw error
    }
  }

  // 计算配合比
  async calculateMixDesign(params) {
    try {
      const { strength, slump, tempSettings, materials, calculationMethod, targetDensity, airContent, flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage, sandRatio, waterRatio: inputWaterRatio } = params

      console.log('开始JGJ 55标准配合比计算...')
      console.log('输入参数:', { strength, slump, tempSettings, calculationMethod, targetDensity, airContent, flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage, sandRatio })

      // 初始化计算步骤
      const calculationSteps = []

      // ========== 步骤1：基本参数 ==========
      const basicParams = [
        { label: '强度等级', value: strength, formula: `f_cu,k = ${parseInt(strength.replace('C', ''))} MPa` },
        { label: '坍落度', value: `${slump} mm` },
        { label: '计算方法', value: calculationMethod === 'mass' ? '质量法' : '绝对体积法' },
        { label: '粉煤灰掺量', value: `${flyAshDosage || 0}%` },
        { label: '矿渣粉掺量', value: `${slagDosage || 0}%` },
        { label: '锂渣掺量', value: `${lithiumSlagDosage || 0}%` },
        { label: '复合粉掺量', value: `${compositePowderDosage || 0}%` }
      ]
      if (calculationMethod === 'mass') {
        basicParams.push({ label: '目标容重', value: `${targetDensity || 2400} kg/m³` })
      } else {
        basicParams.push({ label: '含气量', value: `${airContent !== undefined && airContent !== null ? airContent : 1.0}%` })
      }
      if (sandRatio !== undefined && sandRatio !== null) {
        basicParams.push({ label: '砂率', value: `${sandRatio}%（用户输入）`, isUserInput: true })
      }
      calculationSteps.push({ step: 1, title: '基本参数', details: basicParams })

      // 1. 获取强度标准差σ
      const stdDev = await this.getStrengthStdDev(strength, tempSettings)

      // 2. 计算配置强度 f_cu,0 = f_cu,k + 1.645 × σ
      const targetStrength = this.calculateTargetStrength(strength, stdDev)
      const strengthNum = parseInt(strength.replace('C', ''))

      // ========== 步骤2：配置强度 ==========
      calculationSteps.push({
        step: 2,
        title: '配置强度计算',
        details: [
          { label: '强度标准差σ', value: `${stdDev} MPa` },
          { label: '公式', value: `f_cu,0 = f_cu,k + 1.645 × σ` },
          { label: '代入', value: `f_cu,0 = ${strengthNum} + 1.645 × ${stdDev}` },
          { label: '配置强度', value: `${targetStrength.toFixed(2)} MPa`, highlight: true }
        ]
      })

      // 计算并记录目标细度模数（根据强度等级调整）
      const targetFinenessModulus = this.computeTargetFinenessModulus(strength, tempSettings)
      const baseFm = (tempSettings && tempSettings.targetFinenessModulusBase !== undefined) ? tempSettings.targetFinenessModulusBase : 2.7

      // ========== 步骤3：回归系数 ==========
      const { alphaA, alphaB } = await this.getRegressionCoefficients(tempSettings)
      calculationSteps.push({
        step: 3,
        title: '回归系数',
        details: [
          { label: 'α_a', value: alphaA.toFixed(3) },
          { label: 'α_b', value: alphaB.toFixed(3) },
          { label: '来源', value: tempSettings?.regressionAlphaA !== undefined ? '高级设置' : '默认值（碎石）' }
        ]
      })

      // 4. 计算掺合料影响系数
      let flyAshInfluenceFactor = 1.0
      let slagInfluenceFactor = 1.0
      let lithiumSlagInfluenceFactor = 1.0
      let compositePowderInfluenceFactor = 1.0

      if (flyAshDosage && flyAshDosage > 0 && materials?.flyAsh) {
        flyAshInfluenceFactor = this.calculateInfluenceFactor(flyAshDosage, materials.flyAsh)
      }
      if (slagDosage && slagDosage > 0 && materials?.slag) {
        slagInfluenceFactor = this.calculateInfluenceFactor(slagDosage, materials.slag)
      }
      if (lithiumSlagDosage && lithiumSlagDosage > 0 && materials?.lithiumSlag) {
        lithiumSlagInfluenceFactor = this.calculateInfluenceFactor(lithiumSlagDosage, materials.lithiumSlag)
      }
      if (compositePowderDosage && compositePowderDosage > 0 && materials?.compositePowder) {
        compositePowderInfluenceFactor = this.calculateInfluenceFactor(compositePowderDosage, materials.compositePowder)
      }

      // 计算总掺量及组合影响系数（所有掺合料影响系数直接相乘）
      const totalAdmixtureDosage = (flyAshDosage || 0) + (slagDosage || 0) + (lithiumSlagDosage || 0) + (compositePowderDosage || 0)
      let influenceFactor = flyAshInfluenceFactor * slagInfluenceFactor * lithiumSlagInfluenceFactor * compositePowderInfluenceFactor

      // ========== 步骤4：掺合料影响系数 ==========
      const admixtureDetails = []
      if (flyAshDosage > 0 && materials?.flyAsh) {
        admixtureDetails.push({ label: `粉煤灰（${flyAshDosage}%）影响系数`, value: flyAshInfluenceFactor.toFixed(4) })
      }
      if (slagDosage > 0 && materials?.slag) {
        admixtureDetails.push({ label: `矿渣粉（${slagDosage}%）影响系数`, value: slagInfluenceFactor.toFixed(4) })
      }
      if (lithiumSlagDosage > 0 && materials?.lithiumSlag) {
        admixtureDetails.push({ label: `锂渣（${lithiumSlagDosage}%）影响系数`, value: lithiumSlagInfluenceFactor.toFixed(4) })
      }
      if (compositePowderDosage > 0 && materials?.compositePowder) {
        admixtureDetails.push({ label: `复合粉（${compositePowderDosage}%）影响系数`, value: compositePowderInfluenceFactor.toFixed(4) })
      }
      if (totalAdmixtureDosage > 0) {
        const activeFactors = []
        if (flyAshDosage > 0 && materials?.flyAsh) activeFactors.push(`${flyAshInfluenceFactor.toFixed(4)}`)
        if (slagDosage > 0 && materials?.slag) activeFactors.push(`${slagInfluenceFactor.toFixed(4)}`)
        if (lithiumSlagDosage > 0 && materials?.lithiumSlag) activeFactors.push(`${lithiumSlagInfluenceFactor.toFixed(4)}`)
        if (compositePowderDosage > 0 && materials?.compositePowder) activeFactors.push(`${compositePowderInfluenceFactor.toFixed(4)}`)
        if (activeFactors.length > 1) {
          admixtureDetails.push({ label: '组合影响系数γ_f', value: `${activeFactors.join(' × ')} = ${influenceFactor.toFixed(4)}`, highlight: true })
        } else {
          admixtureDetails.push({ label: '影响系数γ_f', value: influenceFactor.toFixed(4), highlight: true })
        }
      }
      if (admixtureDetails.length > 0) {
        calculationSteps.push({ step: 4, title: '掺合料影响系数', details: admixtureDetails })
      }

      // 5. 计算水胶比
      const cementMaterial = materials?.cement
      const cementStrength28d = cementMaterial?.compressiveStrength28d || 48.0
      const adjustedCementStrength = cementStrength28d * influenceFactor

      // ========== 步骤5：水胶比计算 ==========
      const waterRatio = this.calculateWaterRatio(targetStrength, adjustedCementStrength, alphaA, alphaB)
      calculationSteps.push({
        step: 5,
        title: '水胶比计算',
        details: [
          { label: '水泥28天强度f_ce', value: `${cementStrength28d} MPa` },
          { label: '胶凝材料强度f_b', value: `f_b = f_ce × γ_f = ${adjustedCementStrength.toFixed(2)} MPa` },
          { label: '公式', value: 'W/B = (α_a × f_b) / (f_cu,0 + α_a × α_b × f_b)' },
          { label: '代入', value: `W/B = (${alphaA} × ${adjustedCementStrength.toFixed(2)}) / (${targetStrength.toFixed(2)} + ${alphaA} × ${alphaB} × ${adjustedCementStrength.toFixed(2)})` },
          { label: '水胶比', value: waterRatio.toFixed(4), highlight: true }
        ]
      })

      // 6. 计算用水量
      let coarseAggregateMaterial = materials?.stone
      let maxSize = 25
      let aggregateType = '碎石'

      if (Array.isArray(coarseAggregateMaterial)) {
        let largestSize = 0
        for (const aggregate of coarseAggregateMaterial) {
          const size = this.extractMaxAggregateSize(aggregate.specification)
          if (size > largestSize) {
            largestSize = size
            coarseAggregateMaterial = aggregate
          }
        }
        maxSize = largestSize
      }

      if (coarseAggregateMaterial) {
        maxSize = this.extractMaxAggregateSize(coarseAggregateMaterial.specification)
        aggregateType = coarseAggregateMaterial.name?.includes('卵石') ? '卵石' : '碎石'
      }

      const baseWaterAmount = this.getBaseWaterAmount(maxSize, slump, aggregateType)

      // 7. 计算减水剂掺量
      const fineAggregateMaterial = materials?.sand
      const superplasticizerResult = await this.calculateSuperplasticizerDosage(strength, fineAggregateMaterial, tempSettings)
      const superplasticizerDosage = superplasticizerResult.finalDosage

      // 8. 计算减水率
      const superplasticizerMaterial = materials?.superplasticizer
      const baseDosage = superplasticizerMaterial?.recommendedDosage || 1.5
      const baseReducingRate = superplasticizerMaterial?.waterReducingRate || 25
      const waterReducingRate = await this.calculateWaterReducingRate(baseReducingRate, baseDosage, superplasticizerResult.strengthDosage, tempSettings)

      // ========== 步骤6：减水剂计算 ==========
      const spDetails = [
        { label: '减水剂推荐掺量', value: `${baseDosage}%` },
        { label: '减水剂基准减水率', value: `${baseReducingRate}%` },
        { label: '强度等级调整掺量', value: `${superplasticizerResult.strengthDosage.toFixed(2)}%` }
      ]
      if (superplasticizerResult.mbAdjustment > 0 || superplasticizerResult.fmAdjustment > 0) {
        if (superplasticizerResult.mbAdjustment > 0) {
          spDetails.push({ label: 'MB值调整', value: `+${superplasticizerResult.mbAdjustment.toFixed(4)}%` })
        }
        if (superplasticizerResult.fmAdjustment > 0) {
          spDetails.push({ label: '细度模数调整', value: `+${superplasticizerResult.fmAdjustment.toFixed(4)}%` })
        }
      }
      spDetails.push({ label: '减水剂掺量', value: `${superplasticizerResult.finalDosage.toFixed(2)}%`, highlight: true })
      spDetails.push({ label: '减水率', value: `${waterReducingRate.toFixed(2)}%`, highlight: true })
      calculationSteps.push({ step: 6, title: '减水剂计算', details: spDetails })

      // 9. 计算实际用水量
      let waterAmount = baseWaterAmount * (1 - waterReducingRate / 100)
      const waterAdjustments = [{ label: '基准用水量', value: `${baseWaterAmount} kg/m³` }]

      if (flyAshDosage && flyAshDosage > 0 && materials?.flyAsh?.waterDemandRatio) {
        const flyAshWaterDemandRatio = materials.flyAsh.waterDemandRatio
        const flyAshInfluence = 1 - (100 - flyAshWaterDemandRatio) / 30 * (flyAshDosage / 100)
        waterAmount *= flyAshInfluence
        waterAdjustments.push({ label: `粉煤灰需水量比修正（${flyAshWaterDemandRatio}%）`, value: `× ${flyAshInfluence.toFixed(4)}` })
      }

      if (slagDosage && slagDosage > 0 && materials?.slag?.fluidityRatio) {
        const slagFluidityRatio = materials.slag.fluidityRatio
        const slagInfluence = 1 + (100 - slagFluidityRatio) / 50 * (slagDosage / 100)
        waterAmount *= slagInfluence
        waterAdjustments.push({ label: `矿渣粉流动度比修正（${slagFluidityRatio}%）`, value: `× ${slagInfluence.toFixed(4)}` })
      }

      if (lithiumSlagDosage && lithiumSlagDosage > 0 && materials?.lithiumSlag?.waterDemandRatio) {
        const lithiumSlagWaterDemandRatio = materials.lithiumSlag.waterDemandRatio
        const lithiumSlagInfluence = 1 - (100 - lithiumSlagWaterDemandRatio) / 30 * (lithiumSlagDosage / 100)
        waterAmount *= lithiumSlagInfluence
        waterAdjustments.push({ label: `锂渣需水量比修正（${lithiumSlagWaterDemandRatio}%）`, value: `× ${lithiumSlagInfluence.toFixed(4)}` })
      }

      if (compositePowderDosage && compositePowderDosage > 0 && materials?.compositePowder?.fluidityRatio) {
        const compositePowderFluidityRatio = materials.compositePowder.fluidityRatio
        const compositePowderInfluence = 1 + (100 - compositePowderFluidityRatio) / 50 * (compositePowderDosage / 100)
        waterAmount *= compositePowderInfluence
        waterAdjustments.push({ label: `复合粉流动度比修正（${compositePowderFluidityRatio}%）`, value: `× ${compositePowderInfluence.toFixed(4)}` })
      }

      waterAdjustments.push({ label: '减水率', value: `${waterReducingRate.toFixed(2)}%` })
      waterAdjustments.push({ label: '实际用水量', value: `${waterAmount.toFixed(2)} kg/m³`, highlight: true })

      // ========== 步骤7：用水量计算 ==========
      calculationSteps.push({ step: 6, title: '用水量计算', details: waterAdjustments })

      // 10. 计算胶凝材料总量
      const cementitiousAmount = waterAmount / waterRatio

      // 11. 计算砂率
      let finalSandRatio
      let sandRatioSource = ''
      if (sandRatio !== undefined && sandRatio !== null) {
        finalSandRatio = sandRatio / 100
        sandRatioSource = `${sandRatio}%（用户输入）`
      } else {
        finalSandRatio = this.calculateSandRatio(waterRatio, slump)
        sandRatioSource = `${(finalSandRatio * 100).toFixed(1)}%（计算值）`
      }

      // ========== 步骤8：胶凝材料与砂率 ==========
      const flyAshPercentage = (flyAshDosage || 0) / 100
      const slagPercentage = (slagDosage || 0) / 100
      const lithiumSlagPercentage = (lithiumSlagDosage || 0) / 100
      const compositePowderPercentage = (compositePowderDosage || 0) / 100
      const cementPercentage = 1 - flyAshPercentage - slagPercentage - lithiumSlagPercentage - compositePowderPercentage
      calculationSteps.push({
        step: 7,
        title: '胶凝材料与砂率',
        details: [
          { label: '胶凝材料总量', value: `B = ${waterAmount.toFixed(2)} / ${waterRatio.toFixed(4)} = ${cementitiousAmount.toFixed(2)} kg/m³`, highlight: true },
          { label: '水泥用量', value: `${(cementitiousAmount * cementPercentage).toFixed(2)} kg/m³（${(cementPercentage * 100).toFixed(1)}%）` },
          flyAshDosage > 0 ? { label: '粉煤灰用量', value: `${(cementitiousAmount * flyAshPercentage).toFixed(2)} kg/m³（${flyAshDosage}%）` } : null,
          slagDosage > 0 ? { label: '矿渣粉用量', value: `${(cementitiousAmount * slagPercentage).toFixed(2)} kg/m³（${slagDosage}%）` } : null,
          lithiumSlagDosage > 0 ? { label: '锂渣用量', value: `${(cementitiousAmount * lithiumSlagPercentage).toFixed(2)} kg/m³（${lithiumSlagDosage}%）` } : null,
          compositePowderDosage > 0 ? { label: '复合粉用量', value: `${(cementitiousAmount * compositePowderPercentage).toFixed(2)} kg/m³（${compositePowderDosage}%）` } : null,
          { label: '砂率', value: sandRatioSource, highlight: true }
        ].filter(Boolean)
      })

      const materialAmounts = {
        water: waterAmount,
        cement: cementitiousAmount * Math.max(0, cementPercentage),
        flyAsh: cementitiousAmount * flyAshPercentage,
        slag: cementitiousAmount * slagPercentage,
        lithiumSlag: cementitiousAmount * lithiumSlagPercentage,
        compositePowder: cementitiousAmount * compositePowderPercentage,
        sand: 0,
        stone: 0,
        superplasticizer: cementitiousAmount * (superplasticizerDosage / 100)
      }

      console.log('掺合料分配:', {
        cementPercentage: (cementPercentage * 100).toFixed(1) + '%',
        flyAshPercentage: (flyAshPercentage * 100).toFixed(1) + '%',
        slagPercentage: (slagPercentage * 100).toFixed(1) + '%',
        lithiumSlagPercentage: (lithiumSlagPercentage * 100).toFixed(1) + '%',
        compositePowderPercentage: (compositePowderPercentage * 100).toFixed(1) + '%'
      })

      // 13. 根据计算方法选择计算骨料用量
      let sandAmount, stoneAmount
      const usedAirContent = airContent !== undefined && airContent !== null ? airContent : 1.0
      if (calculationMethod === 'mass') {
        // 质量法：根据目标容重计算骨料总量，再按砂率分配
        const density = targetDensity || 2400
        const aggregateAmount = density - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
        sandAmount = aggregateAmount * finalSandRatio
        stoneAmount = aggregateAmount - sandAmount

        // 调整到目标容重
        const tempMaterialAmounts = {
          ...materialAmounts,
          sand: sandAmount,
          stone: stoneAmount
        }
        const massResult = this.calculateByMassMethod(tempMaterialAmounts, density)
        if (massResult) {
          sandAmount = massResult.materialAmounts.sand
          stoneAmount = massResult.materialAmounts.stone
        }
      } else {
        // 绝对体积法：使用迭代反馈修正，确保总体积 = 1 m³
        // 获取各材料密度
        const cementDensity = materials?.cement?.density || 3.15
        const waterDensity = 1.0
        const spDensity = materials?.superplasticizer?.density || 1.05
        const flyAshDensity = materials?.flyAsh?.density || 2.20
        const slagDensity = materials?.slag?.density || 2.90
        const lithiumSlagDensity = materials?.lithiumSlag?.density || 2.20
        const compositePowderDensity = materials?.compositePowder?.density || 2.90
        const getSandDensity = () => {
          if (Array.isArray(materials.sand)) return materials.sand[0]?.density || 2.63
          return materials.sand?.density || 2.63
        }
        const getStoneDensity = () => {
          if (Array.isArray(materials.stone)) return materials.stone[0]?.density || 2.70
          return materials.stone?.density || 2.70
        }
        const sandDensity = getSandDensity()
        const stoneDensity = getStoneDensity()

        // 初始估算骨料总量（基于假设密度 2400 kg/m³）
        let aggregateAmount = 2400 - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
        let currentSandAmount = aggregateAmount * finalSandRatio
        let currentStoneAmount = aggregateAmount - currentSandAmount

        // 迭代修正，使总体积 = 1 m³
        // 注意：单位必须统一 - 所有材料密度使用 g/cm³ (= kg/L = 1000 kg/m³)
        // 但这里 materialAmounts 是 kg/m³，密度是 g/cm³，需要换算
        // 实际上 density (g/cm³) × 1000 = density (kg/m³)，所以直接除是错的
        // 正确：体积(m³) = 质量(kg/m³) / (密度(g/cm³) × 1000)
        const toM3 = (kgPerM3, gPerCm3) => kgPerM3 / (gPerCm3 * 1000)

        for (let i = 0; i < 10; i++) {
          const cementVol = toM3(materialAmounts.cement, cementDensity)
          const waterVol = toM3(waterAmount, waterDensity)
          const spVol = toM3(materialAmounts.superplasticizer, spDensity)
          const flyAshVol = toM3(materialAmounts.flyAsh || 0, flyAshDensity)
          const slagVol = toM3(materialAmounts.slag || 0, slagDensity)
          const lithiumSlagVol = toM3(materialAmounts.lithiumSlag || 0, lithiumSlagDensity)
          const compositePowderVol = toM3(materialAmounts.compositePowder || 0, compositePowderDensity)
          const airVol = usedAirContent / 100

          const currentSandVol = toM3(currentSandAmount, sandDensity)
          const currentStoneVol = toM3(currentStoneAmount, stoneDensity)
          const totalVolume = cementVol + waterVol + spVol + flyAshVol + slagVol + lithiumSlagVol + compositePowderVol + currentSandVol + currentStoneVol + airVol

          // 目标骨料体积
          const targetAggVol = 1 - cementVol - waterVol - spVol - flyAshVol - slagVol - lithiumSlagVol - compositePowderVol - airVol

          // 当前骨料体积
          const currentAggVol = currentSandVol + currentStoneVol

          // 缩放比例
          const scaleFactor = currentAggVol > 0 ? targetAggVol / currentAggVol : 1

          if (Math.abs(scaleFactor - 1) < 1e-6) break

          currentSandAmount *= scaleFactor
          currentStoneAmount *= scaleFactor

          console.log('绝对体积法迭代' + i + ': scaleFactor=' + scaleFactor.toFixed(6) + ', totalVolume=' + totalVolume.toFixed(4) + ', sandAmount=' + currentSandAmount.toFixed(2) + ', stoneAmount=' + currentStoneAmount.toFixed(2))
        }

        sandAmount = currentSandAmount
        stoneAmount = currentStoneAmount

        // 验证最终结果
        const cementVol = toM3(materialAmounts.cement, cementDensity)
        const waterVol = toM3(waterAmount, waterDensity)
        const spVol = toM3(materialAmounts.superplasticizer, spDensity)
        const flyAshVol = toM3(materialAmounts.flyAsh || 0, flyAshDensity)
        const slagVol = toM3(materialAmounts.slag || 0, slagDensity)
        const lithiumSlagVol = toM3(materialAmounts.lithiumSlag || 0, lithiumSlagDensity)
        const compositePowderVol = toM3(materialAmounts.compositePowder || 0, compositePowderDensity)
        const airVol = usedAirContent / 100
        const sandVol = toM3(sandAmount, sandDensity)
        const stoneVol = toM3(stoneAmount, stoneDensity)
        const finalTotalVol = cementVol + waterVol + spVol + flyAshVol + slagVol + lithiumSlagVol + compositePowderVol + sandVol + stoneVol + airVol
        const finalDensity = materialAmounts.cement + waterAmount + materialAmounts.superplasticizer + (materialAmounts.flyAsh || 0) + (materialAmounts.slag || 0) + (materialAmounts.lithiumSlag || 0) + (materialAmounts.compositePowder || 0) + sandAmount + stoneAmount
        console.log('绝对体积法最终: cementVol=' + cementVol.toFixed(4) + ', waterVol=' + waterVol.toFixed(4) + ', spVol=' + spVol.toFixed(4) + ', flyAshVol=' + flyAshVol.toFixed(4) + ', slagVol=' + slagVol.toFixed(4) + ', lithiumSlagVol=' + lithiumSlagVol.toFixed(4) + ', compositePowderVol=' + compositePowderVol.toFixed(4) + ', sandVol=' + sandVol.toFixed(4) + ', stoneVol=' + stoneVol.toFixed(4) + ', airVol=' + airVol.toFixed(4) + ', totalVolume=' + finalTotalVol.toFixed(4) + ', finalDensity=' + finalDensity.toFixed(2))
      }
      
      // 处理多种骨料的情况
      let fineAggregateOptimalRatio = null
      if (Array.isArray(materials.sand)) {
        // 多种细骨料，使用最佳比例分配，按强度等级确定目标细度模数
        fineAggregateOptimalRatio = this.calculateOptimalFineAggregateRatio(materials.sand, targetFinenessModulus)
        for (const item of fineAggregateOptimalRatio) {
          materialAmounts[`sand_${item.aggregate.id}`] = sandAmount * item.ratio
        }
        // 保留总砂量用于兼容性
        materialAmounts.sand = sandAmount
      } else {
        // 检查是否为混合砂对象
        if (materials.sand.originalRatios && materials.sand.originalAggregateIds) {
          // 混合砂，为密度计算添加各个单一砂的用量
          materials.sand.originalAggregateIds.forEach((aggId, i) => {
            materialAmounts[`sand_${aggId}`] = sandAmount * materials.sand.originalRatios[i]
          })
        }
        // 保留总砂量用于兼容性
        materialAmounts.sand = sandAmount
      }

      if (Array.isArray(materials.stone)) {
        // 多种粗骨料，按等比例分配
        const stoneRatio = 1 / materials.stone.length
        for (const stone of materials.stone) {
          materialAmounts[`stone_${stone.id}`] = stoneAmount * stoneRatio
        }
        // 保留总石量用于兼容性
        materialAmounts.stone = stoneAmount
      } else {
        // 单一粗骨料
        materialAmounts.stone = stoneAmount
      }

      // 准备细骨料和粗骨料的详细分配（复用之前计算的最佳比例）
      let fineAggregateBreakdown = []
      let coarseAggregateBreakdown = []

      if (Array.isArray(materials.sand) && fineAggregateOptimalRatio) {
        fineAggregateBreakdown = fineAggregateOptimalRatio.map(item => ({
          id: item.aggregate.id,
          name: item.aggregate.name,
          amount: sandAmount * item.ratio,
          ratio: item.ratio
        }))
      } else if (materials.sand) {
        // 检查是否为混合砂对象（包含 originalRatios）
        if (materials.sand.originalRatios && materials.sand.originalAggregateIds) {
          // 混合砂，展开为各个单一砂
          fineAggregateBreakdown = materials.sand.originalAggregateIds.map((aggId, i) => {
            return {
              id: aggId,
              name: materials.sand.originalAggregateNames ? materials.sand.originalAggregateNames[i] : `砂_${aggId}`,
              amount: sandAmount * materials.sand.originalRatios[i],
              ratio: materials.sand.originalRatios[i]
            }
          })
        } else {
          // 单一砂
          fineAggregateBreakdown = [{
            id: materials.sand.id,
            name: materials.sand.name,
            amount: sandAmount,
            ratio: 1
          }]
        }
      }
      
      if (Array.isArray(materials.stone)) {
        const stoneRatio = 1 / materials.stone.length
        coarseAggregateBreakdown = materials.stone.map(stone => ({
          id: stone.id,
          name: stone.name,
          amount: stoneAmount * stoneRatio,
          ratio: stoneRatio
        }))
      } else if (materials.stone) {
        coarseAggregateBreakdown = [{
          id: materials.stone.id,
          name: materials.stone.name,
          amount: stoneAmount,
          ratio: 1
        }]
      }
      
      console.log('材料用量:', materialAmounts)
      console.log('细骨料分配:', fineAggregateBreakdown)
      console.log('粗骨料分配:', coarseAggregateBreakdown)

      // ========== 步骤9：骨料用量计算 ==========
      const aggregateDetails = []
      if (calculationMethod === 'mass') {
        const targetD = targetDensity || 2400
        aggregateDetails.push({ label: '计算方法', value: '质量法' })
        aggregateDetails.push({ label: '公式', value: '骨料总量 = 目标容重 - 胶凝材料 - 水 - 外加剂' })
        aggregateDetails.push({ label: '代入', value: `= ${targetD} - ${cementitiousAmount.toFixed(2)} - ${waterAmount.toFixed(2)} - ${materialAmounts.superplasticizer.toFixed(2)}` })
        aggregateDetails.push({ label: '骨料总量', value: `${(targetD - cementitiousAmount - waterAmount - materialAmounts.superplasticizer).toFixed(2)} kg/m³` })
        aggregateDetails.push({ label: '砂率', value: `${(finalSandRatio * 100).toFixed(1)}%` })
        aggregateDetails.push({ label: '细骨料用量', value: `${sandAmount.toFixed(2)} kg/m³`, highlight: true })
        aggregateDetails.push({ label: '粗骨料用量', value: `${stoneAmount.toFixed(2)} kg/m³`, highlight: true })
      } else {
        aggregateDetails.push({ label: '计算方法', value: '绝对体积法' })
        aggregateDetails.push({ label: '总体积', value: '1 m³' })
        aggregateDetails.push({ label: '含气量', value: `${usedAirContent}%` })
        aggregateDetails.push({ label: '砂率', value: `${(finalSandRatio * 100).toFixed(1)}%` })
        aggregateDetails.push({ label: '细骨料用量', value: `${sandAmount.toFixed(2)} kg/m³`, highlight: true })
        aggregateDetails.push({ label: '粗骨料用量', value: `${stoneAmount.toFixed(2)} kg/m³`, highlight: true })
      }

      // 多骨料时添加比例分配信息
      const hasMultipleSand = Array.isArray(materials.sand) && materials.sand.length > 1
      const hasMultipleStone = Array.isArray(materials.stone) && materials.stone.length > 1

      if (hasMultipleSand && fineAggregateOptimalRatio) {
        const sandRatioDetails = fineAggregateOptimalRatio.map(item => ({
          label: `砂-${item.aggregate.name || item.aggregate.id}`,
          value: `用量: ${(sandAmount * item.ratio).toFixed(2)} kg/m³，比例: ${(item.ratio * 100).toFixed(1)}%`
        }))
        aggregateDetails.push({ label: '【细骨料组合】', value: `目标细度模数: ${targetFinenessModulus}` })
        aggregateDetails.push(...sandRatioDetails)
      }

      if (hasMultipleStone) {
        const stoneRatio = 1 / materials.stone.length
        const stoneRatioDetails = materials.stone.map(stone => ({
          label: `石-${stone.name || stone.id}`,
          value: `用量: ${(stoneAmount * stoneRatio).toFixed(2)} kg/m³，比例: ${(stoneRatio * 100).toFixed(1)}%`
        }))
        aggregateDetails.push({ label: '【粗骨料组合】', value: `${materials.stone.length}种粗骨料等比例分配` })
        aggregateDetails.push(...stoneRatioDetails)
      }

      calculationSteps.push({ step: 8, title: '骨料用量计算', details: aggregateDetails })

      // ========== 步骤9：目标细度模数（多种细骨料时） ==========
      if (hasMultipleSand) {
        calculationSteps.push({
          step: 10,
          title: '细骨料组合计算',
          details: [
            { label: '目标细度模数', value: targetFinenessModulus.toFixed(2), formula: `C30基准${baseFm} + (${strengthNum} - 30) × 0.02` },
            { label: '组合方式', value: fineAggregateOptimalRatio?.combinedFinenessModulus !== undefined ? `组合细度模数: ${fineAggregateOptimalRatio.combinedFinenessModulus.toFixed(3)}` : '按比例分配' }
          ]
        })
      }

      // 14. 计算容重
      // 排除 sand 和 stone 聚合键，避免多种骨料时的重复计算
      const densityKeys = Object.keys(materialAmounts).filter(key => key !== 'sand' && key !== 'stone')
      const density = densityKeys.reduce((sum, key) => sum + materialAmounts[key], 0)
      console.log('容重:', density)

    // 15. 计算配合比成本
    const materialCosts = {}
    let totalCost = 0
    let cementitiousCost = 0
    // 计算每种材料的成本（用量单位：kg/m³，单价单位：元/吨，所以需要除以1000）
    const cementPrice = this.toNumber(materials?.cement?.price)
    const flyAshPrice = this.toNumber(materials?.flyAsh?.price)
    const slagPrice = this.toNumber(materials?.slag?.price)
    const lithiumSlagPrice = this.toNumber(materials?.lithiumSlag?.price)
    const compositePowderPrice = this.toNumber(materials?.compositePowder?.price)
    const spPrice = this.toNumber(materials?.superplasticizer?.price)

    console.log('成本计算调试 - 材料价格:')
    console.log('  水泥:', materials?.cement?.name, '价格:', cementPrice, '用量:', materialAmounts.cement)
    console.log('  粉煤灰:', materials?.flyAsh?.name, '价格:', flyAshPrice, '用量:', materialAmounts.flyAsh)
    console.log('  矿渣粉:', materials?.slag?.name, '价格:', slagPrice, '用量:', materialAmounts.slag)
    console.log('  锂渣:', materials?.lithiumSlag?.name, '价格:', lithiumSlagPrice, '用量:', materialAmounts.lithiumSlag)
    console.log('  复合粉:', materials?.compositePowder?.name, '价格:', compositePowderPrice, '用量:', materialAmounts.compositePowder)
    console.log('  减水剂:', materials?.superplasticizer?.name, '价格:', spPrice, '用量:', materialAmounts.superplasticizer)

    if (materials) {
      if (materials.cement && cementPrice > 0) {
        materialCosts.cement = (materialAmounts.cement * cementPrice) / 1000
        totalCost += materialCosts.cement
      }
      if (materials.flyAsh && flyAshPrice > 0) {
        materialCosts.flyAsh = (materialAmounts.flyAsh * flyAshPrice) / 1000
        totalCost += materialCosts.flyAsh
      }
      if (materials.slag && slagPrice > 0) {
        materialCosts.slag = (materialAmounts.slag * slagPrice) / 1000
        totalCost += materialCosts.slag
      }
      if (materials.lithiumSlag && lithiumSlagPrice > 0) {
        materialCosts.lithiumSlag = (materialAmounts.lithiumSlag * lithiumSlagPrice) / 1000
        totalCost += materialCosts.lithiumSlag
      }
      if (materials.compositePowder && compositePowderPrice > 0) {
        materialCosts.compositePowder = (materialAmounts.compositePowder * compositePowderPrice) / 1000
        totalCost += materialCosts.compositePowder
      }

      // 处理多种细骨料的成本
      let sandTotalCost = 0
      if (Array.isArray(materials.sand)) {
        materials.sand.forEach(sand => {
          const sandPrice = this.toNumber(sand?.price)
          if (sand && sandPrice > 0) {
            const key = `sand_${sand.id}`
            if (materialAmounts[key]) {
              materialCosts[key] = (materialAmounts[key] * sandPrice) / 1000
              sandTotalCost += materialCosts[key]
              totalCost += materialCosts[key]
            }
          }
        })
        materialCosts.sand = sandTotalCost
      } else if (materials.sand) {
        const sandPrice = this.toNumber(materials.sand.price)
        // 检查是否为混合砂对象（包含 originalRatios）
        if (materials.sand.originalRatios && materials.sand.originalAggregateIds) {
          // 混合砂，计算每个单一砂的成本
          const sandTotalCostMixed = (materialAmounts.sand * sandPrice) / 1000
          materials.sand.originalAggregateIds.forEach((aggId, i) => {
            const ratio = materials.sand.originalRatios[i]
            const sandKey = `sand_${aggId}`
            if (materialAmounts[sandKey]) {
              // 混合砂中各砂的成本按比例分配
              materialCosts[sandKey] = sandTotalCostMixed * ratio
            }
          })
          materialCosts.sand = sandTotalCostMixed
          totalCost += sandTotalCostMixed
        } else if (sandPrice > 0) {
          // 单一砂
          materialCosts.sand = (materialAmounts.sand * sandPrice) / 1000
          totalCost += materialCosts.sand
        }
      }

      // 处理多种粗骨料的成本
      let stoneTotalCost = 0
      if (Array.isArray(materials.stone)) {
        materials.stone.forEach(stone => {
          const stonePrice = this.toNumber(stone?.price)
          if (stone && stonePrice > 0) {
            const key = `stone_${stone.id}`
            if (materialAmounts[key]) {
              materialCosts[key] = (materialAmounts[key] * stonePrice) / 1000
              stoneTotalCost += materialCosts[key]
              totalCost += materialCosts[key]
            }
          }
        })
        materialCosts.stone = stoneTotalCost
      } else if (materials.stone) {
        const stonePrice = this.toNumber(materials.stone.price)
        if (stonePrice > 0) {
          materialCosts.stone = (materialAmounts.stone * stonePrice) / 1000
          totalCost += materialCosts.stone
        }
      }

      if (materials.superplasticizer && spPrice > 0) {
        materialCosts.superplasticizer = (materialAmounts.superplasticizer * spPrice) / 1000
        totalCost += materialCosts.superplasticizer
      }

      // 计算胶凝材料成本（水泥+粉煤灰+矿渣粉+锂渣+复合粉）
      cementitiousCost = (materialCosts.cement || 0) + (materialCosts.flyAsh || 0) + (materialCosts.slag || 0) + (materialCosts.lithiumSlag || 0) + (materialCosts.compositePowder || 0)
    } else {
      cementitiousCost = 0
    }
    
    console.log('材料成本:', materialCosts)
    // 防止在同时存在细/粗骨料明细键 (sand_*/stone_*) 和聚合键 (sand/stone) 时重复计入
    try {
      const hasSandDetail = Object.keys(materialCosts).some(k => k.startsWith('sand_'))
      const hasStoneDetail = Object.keys(materialCosts).some(k => k.startsWith('stone_'))
      let normalizedTotal = 0
      for (const [k, v] of Object.entries(materialCosts)) {
        if (k === 'sand' && hasSandDetail) continue
        if (k === 'stone' && hasStoneDetail) continue
        normalizedTotal += v || 0
      }
      totalCost = normalizedTotal
    } catch (e) {
      // 如果规范化失败，保留原有的 totalCost
      console.error('规范化总成本失败:', e)
    }
    console.log('总成本:', totalCost)
    console.log('细骨料分配:', fineAggregateBreakdown)
    console.log('粗骨料分配:', coarseAggregateBreakdown)

    return {
      targetStrength,
      strengthStdDev: stdDev,
      waterRatio,
      sandRatio: finalSandRatio,
      density,
      materials: materialAmounts,
      materialCosts,
      totalCost,
      cementitiousCost,
      superplasticizerDosage,
      waterReducingRate,
      influenceFactor,
      calculationMethod: calculationMethod || 'absolute',
      targetDensity: calculationMethod === 'mass' ? (targetDensity || 2400) : undefined,
      airContent: calculationMethod === 'absolute' ? usedAirContent : undefined,
      slump, // 包含用户输入的坍落度值
      fineAggregateBreakdown,
      coarseAggregateBreakdown,
      calculationSteps, // 详细计算步骤
      // 保留原始简化计算结果，用于兼容性
      original: {
        waterRatio: waterRatio,
        sandRatio: finalSandRatio,
        density: density
      }
    };
  } catch (error) {
    console.error('计算配合比失败:', error)
    throw error
  }
}

  // 计算系列配合比（批量计算）
  async calculateSeriesMixDesign(baseParams, strengthRange = null) {
    try {
      const defaultStrengths = ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60']
      const strengths = strengthRange || defaultStrengths
      const results = []

      // 获取基准砂率
      const baseSandRatio = baseParams.sandRatio || 35

      console.log('[系列配合比] 开始计算，sandRatio=' + baseSandRatio + ', sandCount=' + (baseParams.materials?.sand?.length || 0) + ', sandInfo=' + JSON.stringify(baseParams.materials?.sand?.map(s => ({ id: s.id, name: s.name, fm: s.finenessModulus }))))

      for (const strength of strengths) {
        // 计算当前强度等级的砂率（以 C30 为基准，每增减 5MPa 调整 1%）
        const strengthNum = parseInt(strength.replace('C', ''))
        const sandRatioAdjustment = (30 - strengthNum) // C30 为基准，每增减 5MPa 调整 1%
        const currentSandRatio = baseSandRatio + sandRatioAdjustment / 5

        // 深度拷贝 baseParams，确保 materials 对象独立，避免多次计算时相互影响
        const params = {
          ...baseParams,
          strength: strength,
          sandRatio: currentSandRatio,
          materials: JSON.parse(JSON.stringify(baseParams.materials))
        }

        // 计算当前强度的目标细度模数
        const targetFM = this.computeTargetFinenessModulus(strength, baseParams.tempSettings)

        console.log('[系列配合比] strength=' + strength + ', targetFM=' + targetFM + ', sandInfo=' + JSON.stringify(params.materials.sand?.map(s => ({ id: s.id, fm: s.finenessModulus }))))

        // 调用单个配合比计算方法
        const result = await this.calculateMixDesign(params)

        console.log('[系列配合比] strength=' + strength + ', fineAggregateBreakdown=' + JSON.stringify(result.fineAggregateBreakdown?.map(b => ({ id: b.id, ratio: b.ratio, amount: b.amount }))))

        // 添加目标细度模数信息
        result.targetFinenessModulus = targetFM

        results.push({
          strength: strength,
          data: result
        })
      }

      return results
    } catch (error) {
      console.error('计算系列配合比失败:', error)
      throw error
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
    // 基准砂率33%（水胶比0.40，坍落度30-50mm，砂细度模数2.8）
    // 水胶比每增加0.05，砂率增加1%
    // 坍落度每增加20mm，砂率增加1%
    // 砂细度模数每增加0.25，砂率减少0.5%

    const baseSandRatio = 0.33 // 基准砂率33%
    const waterRatioEffect = (waterRatio - 0.40) * 2.0 // 水胶比影响，每增加0.05砂率增加1%
    const slumpEffect = ((slump - 60) / 20) * 0.01 // 坍落度影响，每增加20mm砂率增加1%
    const fmEffect = -(finenessModulus - 2.8) * 0.02 // 细度模数影响，每增加0.25砂率减少0.5%

    // 卵石混凝土砂率比碎石高约2-3%
    const aggregateBonus = aggregateType === 'cobble' ? 0.025 : 0

    let sandRatio = baseSandRatio + waterRatioEffect + slumpEffect + fmEffect + aggregateBonus

    // 限制在合理范围内
    sandRatio = Math.max(0.28, Math.min(0.50, sandRatio))

    return sandRatio
  }

  // 验证配合比
  async validateMixDesign(mixDesign) {
    try {
      const { strength, waterRatio, materials } = mixDesign

      // 1. 验证水胶比（需根据强度等级重新计算允许的最大水胶比）
      const stdDev = await this.getStrengthStdDev(strength)
      const targetStrength = this.calculateTargetStrength(strength, stdDev)
      const { alphaA, alphaB } = await this.getRegressionCoefficients()
      const cementStrength = materials?.cement?.compressiveStrength28d || 48.0
      const requiredWaterRatio = this.calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
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

module.exports = new MixDesignService()
