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
        
        // MB值每增大0.1，掺量增加相应百分比
        mbAdjustment = Math.max(0, mbValue - baseMbValue) / 0.1 * mbInfluence
        
        // 细度模数每减少0.1，掺量增加相应百分比
        fmAdjustment = Math.max(0, baseFinenessModulus - finenessModulus) / 0.1 * finenessInfluence
        
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
  calculateByAbsoluteVolume(materialAmounts, materials) {
    try {
      let totalVolume = 0
      const volumes = {}
      
      // 计算每种材料的绝对体积
      Object.keys(materialAmounts).forEach((key) => {
        const amount = materialAmounts[key]
        const material = materials[key]
        
        if (material && material.density) {
          // 绝对体积 = 质量 / 密度（kg/m³ / kg/m³ = m³）
          const volume = amount / material.density
          volumes[key] = volume
          totalVolume += volume
        } else {
          volumes[key] = 0
        }
      })
      
      // 引入空气体积（默认1%）
      const airVolume = 0.01
      totalVolume += airVolume
      
      console.log('绝对体积法计算:', { volumes, totalVolume })
      
      return {
        volumes,
        totalVolume,
        airVolume
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
      const { strength, slump, environment, tempSettings, materials, calculationMethod, targetDensity, flyAshDosage, slagDosage, sandRatio, waterRatio: inputWaterRatio } = params
      
      console.log('开始JGJ 55标准配合比计算...')
      console.log('输入参数:', { strength, slump, environment, tempSettings, calculationMethod, targetDensity, flyAshDosage, slagDosage, sandRatio })
      console.log('材料对象:', {
        cement: materials?.cement ? { id: materials.cement.id, name: materials.cement.name, price: materials.cement.price } : null,
        flyAsh: materials?.flyAsh ? { id: materials.flyAsh.id, name: materials.flyAsh.name, price: materials.flyAsh.price } : null,
        slag: materials?.slag ? { id: materials.slag.id, name: materials.slag.name, price: materials.slag.price } : null,
        superplasticizer: materials?.superplasticizer ? { id: materials.superplasticizer.id, name: materials.superplasticizer.name, price: materials.superplasticizer.price } : null
      })

      // 1. 获取强度标准差σ
      const stdDev = await this.getStrengthStdDev(strength, tempSettings)
      console.log('强度标准差σ:', stdDev)
      
      // 2. 计算配置强度 f_cu,0 = f_cu,k + 1.645 × σ
      const targetStrength = this.calculateTargetStrength(strength, stdDev)
      console.log('配置强度f_cu,0:', targetStrength)
      // 计算并记录目标细度模数（根据强度等级调整）
      const targetFinenessModulus = this.computeTargetFinenessModulus(strength, tempSettings)
      console.log('目标细度模数:', targetFinenessModulus)
      
      // 3. 获取回归系数
      const { alphaA, alphaB } = await this.getRegressionCoefficients(tempSettings)
      console.log('回归系数:', { alphaA, alphaB })
      
      // 4. 计算掺合料影响系数（使用粉煤灰掺量）
      let influenceFactor = 1.0
      if (flyAshDosage && materials?.flyAsh) {
        influenceFactor = this.calculateInfluenceFactor(flyAshDosage, materials.flyAsh)
      }
      console.log('掺合料影响系数:', influenceFactor)
      
      // 5. 计算水胶比 W/B = (α_a × f_b × γ_f) / (f_cu,0 + α_a × α_b × f_b × γ_f)
      // 从水泥原材料获取28天抗压强度
      const cementMaterial = materials?.cement
      const cementStrength = (cementMaterial?.compressiveStrength28d || 48.0) * influenceFactor // 考虑掺合料影响系数
      console.log('水泥28天抗压强度:', cementMaterial?.compressiveStrength28d || 48.0, 'MPa')
      
      const waterRatio = this.calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
      console.log('水胶比W/B:', waterRatio)
      
      // 6. 计算用水量
      // 从粗骨料原材料获取最大粒径和类型
      let coarseAggregateMaterial = materials?.stone
      let maxSize = 25
      let aggregateType = '碎石'
      
      if (Array.isArray(coarseAggregateMaterial)) {
        // 多种粗骨料的情况，选择最大的粒径
        let largestSize = 0
        for (const aggregate of coarseAggregateMaterial) {
          const size = this.extractMaxAggregateSize(aggregate.specification)
          if (size > largestSize) {
            largestSize = size
            coarseAggregateMaterial = aggregate // 使用最大粒径的骨料作为代表
          }
        }
        maxSize = largestSize
      }
      
      if (coarseAggregateMaterial) {
        maxSize = this.extractMaxAggregateSize(coarseAggregateMaterial.specification)
        // 根据粗骨料名称判断骨料类型
        aggregateType = coarseAggregateMaterial.name?.includes('卵石') ? '卵石' : '碎石'
      }
      console.log('粗骨料最大粒径:', maxSize, 'mm')
      console.log('粗骨料类型:', aggregateType)
      
      const baseWaterAmount = this.getBaseWaterAmount(maxSize, slump, aggregateType)
      console.log('基准用水量:', baseWaterAmount)
      
      // 7. 计算减水剂掺量
      const fineAggregateMaterial = materials?.sand
      const superplasticizerResult = await this.calculateSuperplasticizerDosage(strength, fineAggregateMaterial, tempSettings)
      const superplasticizerDosage = superplasticizerResult.finalDosage
      console.log('减水剂掺量:', superplasticizerDosage)
      
      // 8. 计算减水率
      const superplasticizerMaterial = materials?.superplasticizer
      const baseDosage = superplasticizerMaterial?.recommendedDosage || 1.5 // 从减水剂获取推荐掺量
      const baseReducingRate = superplasticizerMaterial?.waterReducingRate || 25 // 从减水剂获取减水率
      console.log('减水剂推荐掺量:', baseDosage, '%')
      console.log('减水剂基准减水率:', baseReducingRate, '%')
      
      const waterReducingRate = await this.calculateWaterReducingRate(baseReducingRate, baseDosage, superplasticizerResult.strengthDosage, tempSettings)
      console.log('减水率:', waterReducingRate)
      
      // 9. 计算实际用水量
      let waterAmount = baseWaterAmount * (1 - waterReducingRate / 100)
      
      // 考虑粉煤灰需水量比的影响
      if (flyAshDosage && flyAshDosage > 0 && materials?.flyAsh?.waterDemandRatio) {
        const flyAshWaterDemandRatio = materials.flyAsh.waterDemandRatio
        const flyAshInfluence = 1 - (100 - flyAshWaterDemandRatio) / 30 * (flyAshDosage / 100)
        waterAmount *= flyAshInfluence
        console.log('粉煤灰需水量比影响:', flyAshInfluence)
      }
      
      // 考虑矿渣粉流动度比的影响
      if (slagDosage && slagDosage > 0 && materials?.slag?.fluidityRatio) {
        const slagFluidityRatio = materials.slag.fluidityRatio
        const slagInfluence = 1 - (1 - 100 / slagFluidityRatio) / 50 * (slagDosage / 100)
        waterAmount *= slagInfluence
        console.log('矿渣粉流动度比影响:', slagInfluence)
      }
      
      console.log('实际用水量:', waterAmount)

      // 10. 计算胶凝材料总量
      const cementitiousAmount = waterAmount / waterRatio
      console.log('胶凝材料总量:', cementitiousAmount)

      // 11. 计算砂率
      let finalSandRatio
      if (sandRatio !== undefined && sandRatio !== null) {
        finalSandRatio = sandRatio / 100 // 转换为小数
      } else {
        finalSandRatio = this.calculateSandRatio(slump)
      }
      console.log('砂率:', finalSandRatio)

      // 12. 计算初始材料用量
      // 使用用户自定义的粉煤灰和矿渣粉掺量
      const flyAshPercentage = (flyAshDosage || 0) / 100
      const slagPercentage = (slagDosage || 0) / 100
      const cementPercentage = 1 - flyAshPercentage - slagPercentage
      
      let materialAmounts = {
        water: waterAmount,
        cement: cementitiousAmount * Math.max(0, cementPercentage),
        flyAsh: cementitiousAmount * flyAshPercentage,
        slag: cementitiousAmount * slagPercentage,
        sand: 0,
        stone: 0,
        superplasticizer: cementitiousAmount * (superplasticizerDosage / 100)
      }
      
      console.log('掺合料分配:', {
        cementPercentage: (cementPercentage * 100).toFixed(1) + '%',
        flyAshPercentage: (flyAshPercentage * 100).toFixed(1) + '%',
        slagPercentage: (slagPercentage * 100).toFixed(1) + '%'
      })

      // 13. 根据计算方法选择计算
      let sandAmount, stoneAmount
      if (calculationMethod === 'mass') {
        // 质量法
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
        // 绝对体积法（默认）
        const aggregateAmount = 2400 - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
        sandAmount = aggregateAmount * finalSandRatio
        stoneAmount = aggregateAmount - sandAmount
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

      // 14. 计算容重
      // 排除 sand 和 stone 聚合键，避免多种骨料时的重复计算
      const densityKeys = Object.keys(materialAmounts).filter(key => key !== 'sand' && key !== 'stone')
      const density = densityKeys.reduce((sum, key) => sum + materialAmounts[key], 0)
      console.log('容重:', density)

    // 15. 计算配合比成本
    const materialCosts = {}
    let totalCost = 0
    // 计算每种材料的成本（用量单位：kg/m³，单价单位：元/吨，所以需要除以1000）
    const cementPrice = this.toNumber(materials?.cement?.price)
    const flyAshPrice = this.toNumber(materials?.flyAsh?.price)
    const slagPrice = this.toNumber(materials?.slag?.price)
    const spPrice = this.toNumber(materials?.superplasticizer?.price)

    console.log('成本计算调试 - 材料价格:')
    console.log('  水泥:', materials?.cement?.name, '价格:', cementPrice, '用量:', materialAmounts.cement)
    console.log('  粉煤灰:', materials?.flyAsh?.name, '价格:', flyAshPrice, '用量:', materialAmounts.flyAsh)
    console.log('  矿渣粉:', materials?.slag?.name, '价格:', slagPrice, '用量:', materialAmounts.slag)
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
      superplasticizerDosage,
      waterReducingRate,
      influenceFactor,
      calculationMethod: calculationMethod || 'absolute',
      slump, // 包含用户输入的坍落度值
      fineAggregateBreakdown,
      coarseAggregateBreakdown,
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

  // 计算砂率
  calculateSandRatio(slump) {
    // 简化计算，实际应根据骨料级配和坍落度计算
    if (slump <= 80) {
      return 0.38
    } else if (slump <= 120) {
      return 0.40
    } else if (slump <= 160) {
      return 0.42
    } else {
      return 0.44
    }
  }

  // 验证配合比
  async validateMixDesign(mixDesign) {
    try {
      const { strength, waterRatio, materials } = mixDesign

      // 1. 验证水胶比
      const requiredWaterRatio = this.calculateWaterRatio(strength, mixDesign.environment)
      const waterRatioValid = waterRatio <= requiredWaterRatio

      // 2. 验证强度
      const cementAmount = materials.cement || 0
      const flyAshAmount = materials.flyAsh || 0
      const slagAmount = materials.slag || 0
      const cementitiousAmount = cementAmount + flyAshAmount + slagAmount
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
