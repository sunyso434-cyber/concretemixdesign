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

  // 计算多种细骨料的最佳比例，使组合后的细度模数最接近2.7
  calculateOptimalFineAggregateRatio(fineAggregates) {
    if (!Array.isArray(fineAggregates) || fineAggregates.length <= 1) {
      return fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
    }

    // 目标细度模数
    const targetFinenessModulus = 2.7
    
    // 生成可能的比例组合（简化为等间隔的比例）
    const steps = 10 // 每个骨料的比例步数
    let bestCombination = null
    let minDifference = Infinity
    
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
        
        for (let i = 0; i < fineAggregates.length; i++) {
          const aggregate = fineAggregates[i]
          const ratio = ratios[i]
          combinedFinenessModulus += (aggregate.finenessModulus || 2.7) * ratio
          combinedMbValue += (aggregate.mbValue || 0.5) * ratio
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
      return fineAggregates.map((aggregate, index) => ({
        aggregate,
        ratio: bestCombination.ratios[index]
      }))
    }
    
    // 如果没有找到最佳组合，返回等比例
    return fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
  }

  // 计算组合后的细骨料参数
  calculateCombinedFineAggregateParams(fineAggregates) {
    if (!Array.isArray(fineAggregates)) {
      return {
        finenessModulus: fineAggregates?.finenessModulus || 2.7,
        mbValue: fineAggregates?.mbValue || 0.5
      }
    }
    
    if (fineAggregates.length === 1) {
      return {
        finenessModulus: fineAggregates[0].finenessModulus || 2.7,
        mbValue: fineAggregates[0].mbValue || 0.5
      }
    }
    
    // 计算最佳比例
    const optimalRatio = this.calculateOptimalFineAggregateRatio(fineAggregates)
    
    // 计算组合后的参数
    let combinedFinenessModulus = 0
    let combinedMbValue = 0
    
    for (const item of optimalRatio) {
      combinedFinenessModulus += (item.aggregate.finenessModulus || 2.7) * item.ratio
      combinedMbValue += (item.aggregate.mbValue || 0.5) * item.ratio
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
        // 计算组合后的细骨料参数
        const combinedParams = this.calculateCombinedFineAggregateParams(fineAggregateMaterial)
        
        const baseMbValue = 0.5 // 基准MB值
        const baseFinenessModulus = 2.7 // 基准细度模数
        
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
      const { strength, slump, environment, tempSettings, materials, calculationMethod, targetDensity, flyAshDosage, slagDosage, sandRatio } = params
      
      console.log('开始JGJ 55标准配合比计算...')
      console.log('输入参数:', { strength, slump, environment, tempSettings, calculationMethod, targetDensity, flyAshDosage, slagDosage, sandRatio })

      // 1. 获取强度标准差σ
      const stdDev = await this.getStrengthStdDev(strength, tempSettings)
      console.log('强度标准差σ:', stdDev)
      
      // 2. 计算配置强度 f_cu,0 = f_cu,k + 1.645 × σ
      const targetStrength = this.calculateTargetStrength(strength, stdDev)
      console.log('配置强度f_cu,0:', targetStrength)
      
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
      if (Array.isArray(materials.sand)) {
        // 多种细骨料，使用最佳比例分配
        const optimalRatio = this.calculateOptimalFineAggregateRatio(materials.sand)
        for (const item of optimalRatio) {
          materialAmounts[`sand_${item.aggregate.id}`] = sandAmount * item.ratio
        }
        // 保留总砂量用于兼容性
        materialAmounts.sand = sandAmount
      } else {
        // 单一细骨料
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
      
      console.log('材料用量:', materialAmounts)

      // 14. 计算容重
    const density = Object.values(materialAmounts).reduce((sum, amount) => sum + amount, 0)
    console.log('容重:', density)

    // 15. 计算配合比成本
    const materialCosts = {}
    let totalCost = 0
    
    // 计算每种材料的成本（用量单位：kg/m³，单价单位：元/吨，所以需要除以1000）
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
      
      // 处理多种细骨料的成本
      if (Array.isArray(materials.sand)) {
        materials.sand.forEach(sand => {
          if (sand && sand.price) {
            const key = `sand_${sand.id}`
            if (materialAmounts[key]) {
              materialCosts[key] = (materialAmounts[key] * sand.price) / 1000
              totalCost += materialCosts[key]
            }
          }
        })
      } else if (materials.sand && materials.sand.price) {
        materialCosts.sand = (materialAmounts.sand * materials.sand.price) / 1000
        totalCost += materialCosts.sand
      }
      
      // 处理多种粗骨料的成本
      if (Array.isArray(materials.stone)) {
        materials.stone.forEach(stone => {
          if (stone && stone.price) {
            const key = `stone_${stone.id}`
            if (materialAmounts[key]) {
              materialCosts[key] = (materialAmounts[key] * stone.price) / 1000
              totalCost += materialCosts[key]
            }
          }
        })
      } else if (materials.stone && materials.stone.price) {
        materialCosts.stone = (materialAmounts.stone * materials.stone.price) / 1000
        totalCost += materialCosts.stone
      }
      
      if (materials.superplasticizer && materials.superplasticizer.price) {
        materialCosts.superplasticizer = (materialAmounts.superplasticizer * materials.superplasticizer.price) / 1000
        totalCost += materialCosts.superplasticizer
      }
    }
    
    console.log('材料成本:', materialCosts)
    console.log('总成本:', totalCost)

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
      // 保留原始简化计算结果，用于兼容性
      original: {
        waterRatio: waterRatio,
        sandRatio: finalSandRatio,
        density: density
      }
    }
    } catch (error) {
      console.error('计算配合比失败:', error)
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
