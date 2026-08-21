// 浏览器开发环境的 JGJ 55 配合比模拟计算（与主进程真实计算双份维护，仅用于前端联调）
import { calculateFinenessModulus } from '../utils/materialFieldsConfig'
import { mockDB } from './mockData'

  // 全局设置默认值
  const globalSettings = {
    regressionAlphaA: 0.53,
    regressionAlphaB: 0.20,
    strengthStdDev: {
      C20: 4.0,
      C25: 5.0,
      C30: 5.0,
      C35: 5.0,
      C40: 5.0,
      C45: 5.0,
      C50: 6.0,
      C55: 6.0,
      C60: 6.0
    },
    superplasticizerDosage: {
      C20: 1.6,
      C25: 1.7,
      C30: 1.8,
      C35: 1.9,
      C40: 2.0,
      C45: 2.1,
      C50: 2.2,
      C55: 2.3,
      C60: 2.4
    },
    waterReducingRatePer01Dosage: 2.0,
    defaultDensity: 2400
  }

  // 辅助函数：获取强度标准差σ
  const getStrengthStdDev = (strength, tempSettings = null) => {
    if (tempSettings && tempSettings.strengthStdDev) {
      return parseFloat(tempSettings.strengthStdDev)
    }
    
    const strengthNum = parseInt(strength.replace('C', ''))
    if (strengthNum <= 20) {
      return globalSettings.strengthStdDev.C20
    } else if (strengthNum >= 50) {
      return globalSettings.strengthStdDev.C50
    } else {
      return globalSettings.strengthStdDev.C30
    }
  }

  // 配置强度计算
  const calculateTargetStrength = (strength, stdDev) => {
    const strengthNum = parseInt(strength.replace('C', ''))
    return strengthNum + 1.645 * stdDev
  }

  // 水胶比计算
  const calculateWaterRatio = (targetStrength, cementStrength, alphaA, alphaB) => {
    const numerator = alphaA * cementStrength
    const denominator = targetStrength + alphaA * alphaB * cementStrength
    return numerator / denominator
  }

  // 基准用水量计算
  const getBaseWaterAmount = (maxSize, slump, aggregateType = '碎石') => {
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

  // 砂率计算
  const calculateSandRatio = (slump) => {
    if (slump <= 80) return 0.38
    else if (slump <= 120) return 0.40
    else if (slump <= 160) return 0.42
    else return 0.44
  }

  // 计算减水剂掺量（多因素调整）
  // 新规则：基准 = 减水剂材料 recommendedDosage ?? 1.8；C30 基准可被用户覆盖；其他等级派生
  // 没选减水剂材料 → 全 0
  const calculateSuperplasticizerDosage = (strength, fineAggregateMaterial, superplasticizerMaterial = null, tempSettings = null) => {
    if (!superplasticizerMaterial) {
      return { finalDosage: 0, strengthDosage: 0, baseDosage: 0, mbAdjustment: 0, fmAdjustment: 0, hasSuperplasticizer: false }
    }

    // C30 基准：用户覆盖 > 材料推荐 > 1.8 兜底
    const userBase = tempSettings?.superplasticizerDosageBase_C30
    const c30Baseline = (userBase !== undefined && userBase !== null && userBase !== '')
      ? parseFloat(userBase)
      : (parseFloat(superplasticizerMaterial.recommendedDosage) || 1.8)

    // 强度等级掺量：用户单点指定 > 派生
    const userStrength = tempSettings?.[`superplasticizerDosage_${strength}`]
    let strengthDosage
    if (userStrength !== undefined && userStrength !== null && userStrength !== '') {
      strengthDosage = parseFloat(userStrength)
    } else {
      const strengthNum = parseInt(String(strength).replace('C', ''), 10)
      const strengthInfluence = tempSettings?.strengthInfluence || 0.1
      strengthDosage = c30Baseline + ((strengthNum - 30) / 5) * strengthInfluence
    }
    let finalDosage = strengthDosage

    // 砂石微调（不影响减水率）
    let mbAdjustment = 0
    let fmAdjustment = 0
    if (fineAggregateMaterial) {
      const targetFinenessModulus = computeTargetFinenessModulus(strength, tempSettings)
      const baseMbValue = 0.5
      const baseFinenessModulus = targetFinenessModulus
      const mbValue = fineAggregateMaterial.mbValue || baseMbValue
      const finenessModulus = fineAggregateMaterial.finenessModulus || baseFinenessModulus
      const mbInfluence = tempSettings?.mbInfluence || 0.1
      const finenessInfluence = tempSettings?.finenessInfluence || 0.1
      mbAdjustment = ((mbValue - baseMbValue) / 0.1) * mbInfluence
      fmAdjustment = ((baseFinenessModulus - finenessModulus) / 0.1) * finenessInfluence
      finalDosage += mbAdjustment + fmAdjustment
    }

    return {
      finalDosage,
      strengthDosage,
      baseDosage: parseFloat(superplasticizerMaterial.recommendedDosage) || 0,
      mbAdjustment,
      fmAdjustment,
      hasSuperplasticizer: true
    }
  }

  // 计算目标细度模数（可由临时设置覆盖），与后端保持一致的经验规则
  const computeTargetFinenessModulus = (strength, tempSettings = null) => {
    try {
      if (tempSettings && tempSettings.targetFinenessModulus !== undefined && tempSettings.targetFinenessModulus !== null) {
        return parseFloat(tempSettings.targetFinenessModulus)
      }
      const base = 2.7
      const strengthNum = parseInt(String(strength || '').replace('C', '')) || 30
      let target = base - (strengthNum - 30) * 0.01
      if (target < 2.3) target = 2.3
      if (target > 2.9) target = 2.9
      return Number(target.toFixed(3))
    } catch (e) {
      return 2.7
    }
  }

  // 计算多种细骨料的最佳比例，使组合后的细度模数最接近目标值（默认为2.7）
  const calculateOptimalFineAggregateRatio = (fineAggregates, targetFinenessModulus = 2.7) => {
    if (!Array.isArray(fineAggregates) || fineAggregates.length <= 1) {
      const result = (fineAggregates || []).map((aggregate, index) => ({ aggregate, ratio: 1 / Math.max(1, fineAggregates.length) }))
      result.combinedFinenessModulus = fineAggregates && fineAggregates.length === 1 ? (fineAggregates[0].finenessModulus || targetFinenessModulus) : targetFinenessModulus
      result.combinedMbValue = fineAggregates && fineAggregates.length === 1 ? (fineAggregates[0].mbValue || 0.5) : 0.5
      return result
    }

    const steps = 10
    let bestCombination = null
    let minDifference = Infinity

    const sieveKeys = ['sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15']
    const hasDetailedSieve = fineAggregates.every(agg => {
      return sieveKeys.every(k => {
        const v = agg && agg[k]
        const n = parseFloat(v)
        return Number.isFinite(n)
      })
    })

    const generateCombinations = (index, currentRatios) => {
      if (index === fineAggregates.length - 1) {
        const remainingRatio = 1 - currentRatios.reduce((sum, r) => sum + r, 0)
        if (remainingRatio < 0 || remainingRatio > 1) return

        const ratios = [...currentRatios, remainingRatio]

        let combinedFinenessModulus = 0
        let combinedMbValue = 0

        if (hasDetailedSieve) {
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

          combinedFinenessModulus = calculateFinenessModulus(combinedSieve)
        } else {
          for (let i = 0; i < fineAggregates.length; i++) {
            const aggregate = fineAggregates[i]
            const ratio = ratios[i]
            combinedFinenessModulus += (aggregate.finenessModulus || targetFinenessModulus) * ratio
            combinedMbValue += (aggregate.mbValue || 0.5) * ratio
          }
        }

        const difference = Math.abs(combinedFinenessModulus - targetFinenessModulus)
        if (difference < minDifference) {
          minDifference = difference
          bestCombination = { ratios, combinedFinenessModulus, combinedMbValue }
        }
        return
      }

      for (let i = 0; i <= steps; i++) {
        const ratio = i / steps
        const remainingRatio = 1 - currentRatios.reduce((sum, r) => sum + r, 0) - ratio
        if (remainingRatio >= 0) {
          generateCombinations(index + 1, [...currentRatios, ratio])
        }
      }
    }

    generateCombinations(0, [])

    if (bestCombination) {
      const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: bestCombination.ratios[index] }))
      result.combinedFinenessModulus = bestCombination.combinedFinenessModulus
      result.combinedMbValue = bestCombination.combinedMbValue
      return result
    }

    const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
    const combinedFm = fineAggregates.reduce((s, agg) => s + ((agg.finenessModulus || targetFinenessModulus) * (1 / fineAggregates.length)), 0)
    const combinedMb = fineAggregates.reduce((s, agg) => s + ((agg.mbValue || 0.5) * (1 / fineAggregates.length)), 0)
    result.combinedFinenessModulus = combinedFm
    result.combinedMbValue = combinedMb
    return result
  }

  const calculateCombinedFineAggregateParams = (fineAggregates, targetFinenessModulus = 2.7) => {
    const optimalRatio = calculateOptimalFineAggregateRatio(fineAggregates, targetFinenessModulus)
    let combinedFinenessModulus = optimalRatio.combinedFinenessModulus
    let combinedMbValue = optimalRatio.combinedMbValue

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

  // 计算掺合料影响系数（线性插值）
  const calculateInfluenceFactor = (admixtureDosage, admixtureMaterial) => {
    const dosageLevels = [10, 20, 30, 40, 50]
    const factors = {
      10: Math.max(0.1, admixtureMaterial?.influenceFactor_10 || 1.0),
      20: Math.max(0.1, admixtureMaterial?.influenceFactor_20 || 1.0),
      30: Math.max(0.1, admixtureMaterial?.influenceFactor_30 || 1.05),
      40: Math.max(0.1, admixtureMaterial?.influenceFactor_40 || 1.1),
      50: Math.max(0.1, admixtureMaterial?.influenceFactor_50 || 1.15)
    }
    
    let lowerLevel = dosageLevels[0]
    let upperLevel = dosageLevels[dosageLevels.length - 1]
    
    for (let i = 0; i < dosageLevels.length - 1; i++) {
      if (admixtureDosage >= dosageLevels[i] && admixtureDosage <= dosageLevels[i + 1]) {
        lowerLevel = dosageLevels[i]
        upperLevel = dosageLevels[i + 1]
        break
      }
    }
    
    if (admixtureDosage < lowerLevel) {
      return factors[lowerLevel]
    }
    if (admixtureDosage > upperLevel) {
      return factors[upperLevel]
    }
    
    const lowerFactor = factors[lowerLevel]
    const upperFactor = factors[upperLevel]
    const t = (admixtureDosage - lowerLevel) / (upperLevel - lowerLevel)
    const finalFactor = lowerFactor + t * (upperFactor - lowerFactor)
    
    console.log('掺合料影响系数计算（模拟）:', {
      admixtureDosage,
      lowerLevel,
      upperLevel,
      lowerFactor,
      upperFactor,
      t,
      finalFactor
    })
    
    return Math.max(0.1, finalFactor)
  }

  // 质量法计算
  const calculateByMassMethod = (materialAmounts, targetDensity = 2400) => {
    const currentDensity = Object.values(materialAmounts).reduce((sum, amount) => sum + amount, 0)
    const scaleFactor = targetDensity / currentDensity
    const scaledMaterialAmounts = {}
    
    Object.keys(materialAmounts).forEach((key) => {
      scaledMaterialAmounts[key] = materialAmounts[key] * scaleFactor
    })
    
    const finalDensity = Object.values(scaledMaterialAmounts).reduce((sum, amount) => sum + amount, 0)
    
    return {
      materialAmounts: scaledMaterialAmounts,
      targetDensity,
      finalDensity,
      scaleFactor
    }
  }

  // 计算配合比 - JGJ 55标准版本（增强：支持多细/粗骨料分配与成本）
  const calculateMixDesignMock = (params) => {
    const { strength, slump, environment, tempSettings, materials, calculationMethod, targetDensity, flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage, sandRatio } = params

    console.log('开始JGJ 55标准配合比计算（模拟 - 多骨料支持）...')

    // 1. 基本计算（同真实逻辑，略简化）
    const stdDev = getStrengthStdDev(strength, tempSettings)
    const targetStrength = calculateTargetStrength(strength, stdDev)
    // 计算目标细度模数（用于细骨料组合与减水剂调整）
    const targetFinenessModulus = computeTargetFinenessModulus(strength, tempSettings)
    const alphaA = (tempSettings && tempSettings.regressionAlphaA) ? parseFloat(tempSettings.regressionAlphaA) : globalSettings.regressionAlphaA
    const alphaB = (tempSettings && tempSettings.regressionAlphaB) ? parseFloat(tempSettings.regressionAlphaB) : globalSettings.regressionAlphaB

    const flyAshMaterial = materials?.flyAsh || mockDB.materials.find(m => m.type === '粉煤灰')
    const slagMaterial = materials?.slag || mockDB.materials.find(m => m.type === '矿渣粉')
    const lithiumSlagMaterial = materials?.lithiumSlag || mockDB.materials.find(m => m.type === '锂渣')
    const compositePowderMaterial = materials?.compositePowder || mockDB.materials.find(m => m.type === '复合粉')
    let influenceFactor = 1.0
    if (flyAshDosage && flyAshMaterial) influenceFactor *= calculateInfluenceFactor(flyAshDosage, flyAshMaterial)
    if (slagDosage && slagMaterial) influenceFactor *= calculateInfluenceFactor(slagDosage, slagMaterial)
    if (lithiumSlagDosage && lithiumSlagMaterial) influenceFactor *= calculateInfluenceFactor(lithiumSlagDosage, lithiumSlagMaterial)
    if (compositePowderDosage && compositePowderMaterial) influenceFactor *= calculateInfluenceFactor(compositePowderDosage, compositePowderMaterial)

    const cementMaterial = materials?.cement || mockDB.materials.find(m => m.type === '水泥')
    const cementStrength = (cementMaterial?.compressiveStrength28d || 48.0) * influenceFactor
    const waterRatio = calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)

    // 粗骨料最大粒径与类型（支持数组）
    let coarse = materials?.stone
    let maxSize = 25
    let aggregateType = '碎石'
    if (Array.isArray(coarse) && coarse.length > 0) {
      // 取最大规格为代表
      let largest = coarse[0]
      let largestSize = 0
      for (const s of coarse) {
        const m = (s.specification || '').match(/(\d+)-(\d+)mm/)
        if (m) {
          const size = parseInt(m[2])
          if (size > largestSize) { largestSize = size; largest = s }
        }
      }
      coarse = largest
    }
    if (coarse && coarse.specification) {
      const match = coarse.specification.match(/(\d+)-(\d+)mm/)
      if (match) maxSize = parseInt(match[2])
      else {
        const sm = coarse.specification.match(/(\d+)mm/)
        if (sm) maxSize = parseInt(sm[1])
      }
      aggregateType = coarse.name?.includes('卵石') ? '卵石' : '碎石'
    }

    const baseWaterAmount = getBaseWaterAmount(maxSize, slump, aggregateType)

    // 减水剂掺量（合并细骨料参数时使用优化后的组合参数）
    let fine = materials?.sand
    let combinedFine = null
    if (Array.isArray(fine) && fine.length > 0) {
      const combinedParams = calculateCombinedFineAggregateParams(fine, targetFinenessModulus)
      combinedFine = { mbValue: combinedParams.mbValue, finenessModulus: combinedParams.finenessModulus }
      console.log('细骨料组合参数（模拟）:', combinedParams)
    } else if (fine) {
      combinedFine = fine
    }

    const superplasticizerMaterial = mockDB.materials.find(m => m.id === materials?.superplasticizer) || mockDB.materials.find(m => m.type === '外加剂')
    const spResult = calculateSuperplasticizerDosage(strength, combinedFine, superplasticizerMaterial, tempSettings)
    const finalDosage = spResult.finalDosage || spResult

    // 减水率（新规则：基准=材料推荐掺量，掺量=strengthDosage，砂石微调不影响减水率）
    let waterReducingRate = 0
    if (superplasticizerMaterial) {
      const baseDosage = parseFloat(superplasticizerMaterial.recommendedDosage) || 0
      const baseReducingRate = parseFloat(superplasticizerMaterial.waterReducingRate) || 25
      const ratePer01 = superplasticizerMaterial.waterReducingRatePer01Dosage || globalSettings.waterReducingRatePer01Dosage || 2.0
      const dosageDiff = (spResult.strengthDosage || 0) - baseDosage
      waterReducingRate = baseReducingRate + (dosageDiff / 0.1) * ratePer01
    }

    // 实际用水量（考虑粉煤灰、矿渣影响的简化处理）
    let waterAmount = baseWaterAmount * (1 - waterReducingRate / 100)
    if (flyAshDosage && materials?.flyAsh?.waterDemandRatio) {
      const flyAshWaterDemandRatio = materials.flyAsh.waterDemandRatio
      const flyAshInfluence = 1 - (100 - flyAshWaterDemandRatio) / 30 * (flyAshDosage / 100)
      waterAmount *= flyAshInfluence
    }
    if (slagDosage && materials?.slag?.fluidityRatio) {
      const slagFluidityRatio = materials.slag.fluidityRatio
      const slagInfluence = 1 + (100 - slagFluidityRatio) / 50 * (slagDosage / 100)
      waterAmount *= slagInfluence
    }
    if (lithiumSlagDosage && materials?.lithiumSlag?.waterDemandRatio) {
      const lithiumSlagWaterDemandRatio = materials.lithiumSlag.waterDemandRatio
      const lithiumSlagInfluence = 1 - (100 - lithiumSlagWaterDemandRatio) / 30 * (lithiumSlagDosage / 100)
      waterAmount *= lithiumSlagInfluence
    }
    if (compositePowderDosage && materials?.compositePowder?.fluidityRatio) {
      const compositePowderFluidityRatio = materials.compositePowder.fluidityRatio
      const compositePowderInfluence = 1 + (100 - compositePowderFluidityRatio) / 50 * (compositePowderDosage / 100)
      waterAmount *= compositePowderInfluence
    }

    const cementitiousAmount = waterAmount / waterRatio

    // 砂率
    let finalSandRatio = (sandRatio !== undefined && sandRatio !== null) ? sandRatio / 100 : calculateSandRatio(slump)

    // 初始材料用量
    const flyAshPercentage = (flyAshDosage || 0) / 100
    const slagPercentage = (slagDosage || 0) / 100
    const lithiumSlagPercentage = (lithiumSlagDosage || 0) / 100
    const compositePowderPercentage = (compositePowderDosage || 0) / 100
    const cementPercentage = 1 - flyAshPercentage - slagPercentage - lithiumSlagPercentage - compositePowderPercentage

    let materialAmounts = {
      water: waterAmount,
      cement: cementitiousAmount * Math.max(0, cementPercentage),
      flyAsh: cementitiousAmount * flyAshPercentage,
      slag: cementitiousAmount * slagPercentage,
      lithiumSlag: cementitiousAmount * lithiumSlagPercentage,
      compositePowder: cementitiousAmount * compositePowderPercentage,
      sand: 0,
      stone: 0,
      superplasticizer: cementitiousAmount * (finalDosage / 100)
    }

    // 质量法/绝对体积法（简化）
    if (calculationMethod === 'mass') {
      const density = targetDensity || 2400
      const aggregateAmount = density - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
      materialAmounts.sand = aggregateAmount * finalSandRatio
      materialAmounts.stone = aggregateAmount - materialAmounts.sand
    } else {
      const aggregateAmount = 2400 - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
      materialAmounts.sand = aggregateAmount * finalSandRatio
      materialAmounts.stone = aggregateAmount - materialAmounts.sand
    }

    // 支持多种细/粗骨料分配
    let fineAggregateBreakdown = []
    let coarseAggregateBreakdown = []
    if (Array.isArray(materials?.sand) && materials.sand.length > 0) {
      const optimalRatio = calculateOptimalFineAggregateRatio(materials.sand, targetFinenessModulus)
      for (const item of optimalRatio) {
        const ratio = item.ratio || (1 / materials.sand.length)
        const key = `sand_${item.aggregate.id}`
        materialAmounts[key] = materialAmounts.sand * ratio
        fineAggregateBreakdown.push({ id: item.aggregate.id, name: item.aggregate.name, amount: materialAmounts[key], ratio })
      }
    } else if (materials?.sand) {
      fineAggregateBreakdown.push({ id: materials.sand.id, name: materials.sand.name, amount: materialAmounts.sand, ratio: 1 })
    }

    if (Array.isArray(materials?.stone) && materials.stone.length > 0) {
      const len = materials.stone.length
      const ratio = 1 / len
      materials.stone.forEach(s => {
        const key = `stone_${s.id}`
        materialAmounts[key] = materialAmounts.stone * ratio
        coarseAggregateBreakdown.push({ id: s.id, name: s.name, amount: materialAmounts[key], ratio })
      })
    } else if (materials?.stone) {
      coarseAggregateBreakdown.push({ id: materials.stone.id, name: materials.stone.name, amount: materialAmounts.stone, ratio: 1 })
    }

    // 容重
    const density = Object.values(materialAmounts).reduce((s, a) => s + a, 0)

    // 成本计算（支持多种骨料）
    const materialCosts = {}
    let totalCost = 0
    if (materials) {
      if (materials.cement && materials.cement.price) {
        materialCosts.cement = (materialAmounts.cement * materials.cement.price) / 1000
        totalCost += materialCosts.cement
      }
      if (materials.flyAsh && materials.flyAsh.price) {
        materialCosts.flyAsh = (materialAmounts.flyAsh * materials.flyAsh.price) / 1000
        totalCost += materialCosts.flyAsh
      }
      if (materials.slag && materials.slag.price) {
        materialCosts.slag = (materialAmounts.slag * materials.slag.price) / 1000
        totalCost += materialCosts.slag
      }
      if (materials.lithiumSlag && materials.lithiumSlag.price) {
        materialCosts.lithiumSlag = (materialAmounts.lithiumSlag * materials.lithiumSlag.price) / 1000
        totalCost += materialCosts.lithiumSlag
      }
      if (materials.compositePowder && materials.compositePowder.price) {
        materialCosts.compositePowder = (materialAmounts.compositePowder * materials.compositePowder.price) / 1000
        totalCost += materialCosts.compositePowder
      }

      // 细骨料
      if (Array.isArray(materials.sand)) {
        let sandTotal = 0
        materials.sand.forEach(s => {
          const key = `sand_${s.id}`
          if (materialAmounts[key] && s.price) {
            materialCosts[key] = (materialAmounts[key] * s.price) / 1000
            sandTotal += materialCosts[key]
            totalCost += materialCosts[key]
          }
        })
        materialCosts.sand = sandTotal
      } else if (materials.sand && materials.sand.price) {
        materialCosts.sand = (materialAmounts.sand * materials.sand.price) / 1000
        totalCost += materialCosts.sand
      }

      // 粗骨料
      if (Array.isArray(materials.stone)) {
        let stoneTotal = 0
        materials.stone.forEach(s => {
          const key = `stone_${s.id}`
          if (materialAmounts[key] && s.price) {
            materialCosts[key] = (materialAmounts[key] * s.price) / 1000
            stoneTotal += materialCosts[key]
            totalCost += materialCosts[key]
          }
        })
        materialCosts.stone = stoneTotal
      } else if (materials.stone && materials.stone.price) {
        materialCosts.stone = (materialAmounts.stone * materials.stone.price) / 1000
        totalCost += materialCosts.stone
      }

      if (materials.superplasticizer && materials.superplasticizer.price) {
        materialCosts.superplasticizer = (materialAmounts.superplasticizer * materials.superplasticizer.price) / 1000
        totalCost += materialCosts.superplasticizer
      }
    }

    console.log('模拟材料用量:', materialAmounts)
    console.log('模拟细骨料分配:', fineAggregateBreakdown)
    console.log('模拟粗骨料分配:', coarseAggregateBreakdown)
    // 规范化总成本：当存在 sand_* / stone_* 明细时，不重复加入聚合键 sand/stone
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
      console.error('模拟总成本规范化失败:', e)
    }
    console.log('模拟材料成本:', materialCosts, '总成本:', totalCost)

    return {
      targetStrength,
      strengthStdDev: stdDev,
      waterRatio,
      sandRatio: finalSandRatio,
      density,
      materials: materialAmounts,
      materialCosts,
      totalCost,
      superplasticizerDosage: finalDosage,
      waterReducingRate,
      influenceFactor,
      calculationMethod: calculationMethod || 'absolute',
      slump,
      fineAggregateBreakdown,
      coarseAggregateBreakdown
    }
  }

  // 验证配合比
  const validateMixDesignMock = (mixDesign) => {
    return {
      waterRatioValid: true,
      strengthValid: true,
      densityValid: true,
      overallValid: true
    }
  }

  // 优化配合比
  const optimizeMixDesignMock = (mixDesign) => {
    const { materials } = mixDesign
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
  }

export { calculateMixDesignMock, validateMixDesignMock, optimizeMixDesignMock }

