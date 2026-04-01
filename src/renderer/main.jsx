import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// 添加全局错误处理
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error('全局JS错误:', msg, '位置:', url, lineNo, columnNo, error)
}

// 为浏览器环境添加模拟的electron API，方便开发测试
if (!window.electron) {
  // 模拟材料数据
  // 模拟方案数据
  let mockSchemes = [
    {
      id: 1,
      name: '测试方案1',
      projectName: '测试项目1',
      strength: 'C30',
      slump: 80,
      environment: '一般环境',
      waterRatio: 0.45,
      sandRatio: 0.4,
      density: 2400,
      materials: {
        cement: 300,
        flyAsh: 50,
        sand: 750,
        stone: 1050,
        water: 160,
        superplasticizer: 6
      },
      status: '未验证',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 2,
      name: '测试方案2',
      projectName: '测试项目2',
      strength: 'C40',
      slump: 100,
      environment: '一般环境',
      waterRatio: 0.4,
      sandRatio: 0.38,
      density: 2420,
      materials: {
        cement: 350,
        flyAsh: 40,
        sand: 720,
        stone: 1080,
        water: 150,
        superplasticizer: 7
      },
      status: '已验证',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
  let nextSchemeId = 3

  // 模拟材料数据
  let mockMaterials = [
    {
      id: 1,
      name: 'P·O 42.5R水泥',
      type: '水泥',
      specification: '42.5R',
      manufacturer: '都江堰拉法基水泥有限公司',
      density: 3.10,
      fineness: 350,
      compressiveStrength28d: 48.0,
      price: 450,
      status: '正常'
    },
    {
      id: 2,
      name: 'P·II 52.5R水泥',
      type: '水泥',
      specification: '52.5R',
      manufacturer: '四川峨胜水泥集团股份有限公司',
      density: 3.15,
      fineness: 380,
      compressiveStrength28d: 58.0,
      price: 520,
      status: '正常'
    },
    {
      id: 3,
      name: 'I级粉煤灰',
      type: '粉煤灰',
      specification: 'I级',
      manufacturer: '内江聚达创环保新材料有限公司',
      density: 2.20,
      fineness: 400,
      influenceFactor_10: 1.0,
      influenceFactor_20: 1.0,
      influenceFactor_30: 1.05,
      influenceFactor_40: 1.1,
      influenceFactor_50: 1.15,
      price: 180,
      status: '正常'
    },
    {
      id: 4,
      name: 'II级粉煤灰',
      type: '粉煤灰',
      specification: 'II级',
      manufacturer: '成都华西绿舍环保科技有限公司',
      density: 2.30,
      fineness: 320,
      influenceFactor_10: 1.0,
      influenceFactor_20: 1.0,
      influenceFactor_30: 1.08,
      influenceFactor_40: 1.12,
      influenceFactor_50: 1.18,
      price: 150,
      status: '正常'
    },
    {
      id: 5,
      name: 'S95矿渣粉',
      type: '矿渣粉',
      specification: 'S95',
      manufacturer: '四川攀钢集团',
      density: 2.90,
      fineness: 420,
      price: 220,
      status: '正常'
    },
    {
      id: 6,
      name: 'S105矿渣粉',
      type: '矿渣粉',
      specification: 'S105',
      manufacturer: '昆明钢铁集团',
      density: 2.88,
      fineness: 480,
      price: 250,
      status: '正常'
    },
    {
      id: 7,
      name: '机制砂',
      type: '细骨料',
      specification: '中砂',
      manufacturer: '汶川',
      density: 2.65,
      mbValue: 0.5,
      finenessModulus: 2.7,
      price: 120,
      status: '正常'
    },
    {
      id: 8,
      name: '河砂',
      type: '细骨料',
      specification: '细砂',
      manufacturer: '乐山',
      density: 2.62,
      mbValue: 0.3,
      finenessModulus: 2.4,
      price: 150,
      status: '正常'
    },
    {
      id: 9,
      name: '碎石',
      type: '粗骨料',
      specification: '5-25mm',
      manufacturer: '汶川',
      density: 2.70,
      fineness: null,
      price: 100,
      status: '正常'
    },
    {
      id: 10,
      name: '卵石',
      type: '粗骨料',
      specification: '5-20mm',
      manufacturer: '绵阳',
      density: 2.68,
      fineness: null,
      price: 90,
      status: '正常'
    },
    {
      id: 11,
      name: '聚羧酸减水剂（标准型）',
      type: '外加剂',
      specification: 'SSS-标准型',
      manufacturer: '四川同升化工科技有限公司',
      density: 1.05,
      solidContent: 20.0,
      waterReducingRate: 25.0,
      recommendedDosage: 1.5,
      waterReducingRatePer01Dosage: 2.0,
      price: 2500,
      status: '正常'
    },
    {
      id: 12,
      name: '聚羧酸减水剂（缓凝型）',
      type: '外加剂',
      specification: 'SSS-缓凝型',
      manufacturer: '四川同升化工科技有限公司',
      density: 1.08,
      solidContent: 22.0,
      waterReducingRate: 28.0,
      recommendedDosage: 1.8,
      waterReducingRatePer01Dosage: 2.0,
      price: 2800,
      status: '正常'
    }
  ]
  let nextId = 13

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
  const calculateSuperplasticizerDosage = (strength, fineAggregateMaterial, tempSettings = null) => {
    const baseMbValue = 0.5
    const baseFinenessModulus = 2.7
    
    // 强度等级调整
    const strengthNum = parseInt(strength.replace('C', ''))
    const baseDosage = 1.8
    const baseStrength = 30
    const difference = (strengthNum - baseStrength) / 5
    // 获取高级设置中的强度影响参数，默认为0.1%
    const strengthInfluence = tempSettings?.strengthInfluence || 0.1
    const strengthDosage = baseDosage + difference * strengthInfluence
    let finalDosage = strengthDosage
    
    // MB值和细度模数调整
    let mbAdjustment = 0
    let fmAdjustment = 0
    
    if (fineAggregateMaterial) {
      const mbValue = fineAggregateMaterial.mbValue || baseMbValue
      const finenessModulus = fineAggregateMaterial.finenessModulus || baseFinenessModulus
      
      // 获取高级设置中的影响参数，默认为0.1%
      const mbInfluence = tempSettings?.mbInfluence || 0.1
      const finenessInfluence = tempSettings?.finenessInfluence || 0.1
      
      mbAdjustment = Math.max(0, mbValue - baseMbValue) / 0.1 * mbInfluence
      fmAdjustment = Math.max(0, baseFinenessModulus - finenessModulus) / 0.1 * finenessInfluence
      
      finalDosage += mbAdjustment + fmAdjustment
      
      console.log('减水剂掺量调整（模拟）:', {
        strength,
        strengthNum,
        baseDosage,
        strengthDosage,
        difference,
        mbValue,
        mbAdjustment,
        finenessModulus,
        fmAdjustment,
        finalDosage
      })
    }
    
    return {
      finalDosage,
      strengthDosage,
      baseDosage,
      mbAdjustment,
      fmAdjustment
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

  // 计算配合比 - JGJ 55标准版本
  const calculateMixDesignMock = (params) => {
    const { strength, slump, environment, tempSettings, materials, calculationMethod, targetDensity, flyAshDosage, slagDosage, sandRatio } = params
    
    console.log('开始JGJ 55标准配合比计算（模拟）...')
    console.log('输入参数:', { strength, slump, environment, tempSettings, calculationMethod, targetDensity, flyAshDosage, slagDosage, sandRatio })

    // 1. 获取强度标准差σ
    const stdDev = getStrengthStdDev(strength, tempSettings)
    console.log('强度标准差σ:', stdDev)
    
    // 2. 计算配置强度
    const targetStrength = calculateTargetStrength(strength, stdDev)
    console.log('配置强度f_cu,0:', targetStrength)
    
    // 3. 获取回归系数
    const alphaA = (tempSettings && tempSettings.regressionAlphaA) 
      ? parseFloat(tempSettings.regressionAlphaA) 
      : globalSettings.regressionAlphaA
    const alphaB = (tempSettings && tempSettings.regressionAlphaB) 
      ? parseFloat(tempSettings.regressionAlphaB) 
      : globalSettings.regressionAlphaB
    console.log('回归系数:', { alphaA, alphaB })
    
    // 4. 计算掺合料影响系数（使用粉煤灰掺量）
    let influenceFactor = 1.0
    const flyAshMaterial = materials?.flyAsh || mockMaterials.find(m => m.type === '粉煤灰')
    if (flyAshDosage && flyAshMaterial) {
      influenceFactor = calculateInfluenceFactor(flyAshDosage, flyAshMaterial)
    }
    console.log('掺合料影响系数:', influenceFactor)
    
    // 5. 计算水胶比
    // 从水泥原材料获取28天抗压强度
    const cementMaterial = materials?.cement || mockMaterials.find(m => m.type === '水泥')
    const cementStrength = (cementMaterial?.compressiveStrength28d || 48.0) * influenceFactor // 考虑掺合料影响系数
    console.log('水泥28天抗压强度:', cementMaterial?.compressiveStrength28d || 48.0, 'MPa')
    
    const waterRatio = calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
    console.log('水胶比W/B:', waterRatio)
    
    // 6. 计算基准用水量
    // 从粗骨料原材料获取最大粒径和类型
    const coarseAggregateMaterial = materials?.stone || mockMaterials.find(m => m.type === '粗骨料')
    let maxSize = 25
    if (coarseAggregateMaterial && coarseAggregateMaterial.specification) {
      const match = coarseAggregateMaterial.specification.match(/(\d+)-(\d+)mm/)
      if (match) {
        maxSize = parseInt(match[2])
      } else {
        const singleMatch = coarseAggregateMaterial.specification.match(/(\d+)mm/)
        if (singleMatch) {
          maxSize = parseInt(singleMatch[1])
        }
      }
    }
    // 根据粗骨料名称判断骨料类型
    const aggregateType = coarseAggregateMaterial?.name?.includes('卵石') ? '卵石' : '碎石'
    console.log('粗骨料最大粒径:', maxSize, 'mm')
    console.log('粗骨料类型:', aggregateType)
    
    const baseWaterAmount = getBaseWaterAmount(maxSize, slump, aggregateType)
    console.log('基准用水量:', baseWaterAmount)
    
    // 7. 计算减水剂掺量
    const sandMaterial = materials?.sand || mockMaterials.find(m => m.type === '细骨料')
    console.log('细骨料MB值:', sandMaterial?.mbValue || 0.5)
    console.log('细骨料细度模数:', sandMaterial?.finenessModulus || 2.7)
    
    const superplasticizerDosage = calculateSuperplasticizerDosage(strength, sandMaterial, tempSettings)
    console.log('减水剂掺量:', superplasticizerDosage)
    
    // 8. 计算减水率
    const superplasticizerMaterial = mockMaterials.find(m => m.id === materials?.superplasticizer) || mockMaterials.find(m => m.type === '外加剂')
    const baseDosage = superplasticizerMaterial?.recommendedDosage || 1.8 // 从减水剂获取推荐掺量
    const baseReducingRate = superplasticizerMaterial?.waterReducingRate || 25 // 从减水剂获取减水率
    console.log('减水剂推荐掺量:', baseDosage, '%')
    console.log('减水剂基准减水率:', baseReducingRate, '%')
    
    const ratePer01 = globalSettings.waterReducingRatePer01Dosage
    const dosageDiff = superplasticizerDosage.strengthDosage - baseDosage // 只考虑强度等级调整的掺量变化
    const rateAdjustment = (dosageDiff / 0.1) * ratePer01
    const waterReducingRate = baseReducingRate + rateAdjustment
    console.log('减水率:', waterReducingRate)
    
    // 9. 计算实际用水量
    const waterAmount = baseWaterAmount * (1 - waterReducingRate / 100)
    console.log('实际用水量:', waterAmount)

    // 10. 计算胶凝材料总量
    const cementitiousAmount = waterAmount / waterRatio
    console.log('胶凝材料总量:', cementitiousAmount)

    // 11. 计算砂率
    let finalSandRatio
    if (sandRatio !== undefined && sandRatio !== null) {
      finalSandRatio = sandRatio / 100
    } else {
      finalSandRatio = calculateSandRatio(slump)
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
      superplasticizer: cementitiousAmount * (superplasticizerDosage.finalDosage / 100)
    }
    
    console.log('掺合料分配:', {
      cementPercentage: (cementPercentage * 100).toFixed(1) + '%',
      flyAshPercentage: (flyAshPercentage * 100).toFixed(1) + '%',
      slagPercentage: (slagPercentage * 100).toFixed(1) + '%'
    })

    // 13. 根据计算方法选择计算
    if (calculationMethod === 'mass') {
      const density = targetDensity || 2400
      const aggregateAmount = density - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
      materialAmounts.sand = aggregateAmount * finalSandRatio
      materialAmounts.stone = aggregateAmount - materialAmounts.sand
      
      const massResult = calculateByMassMethod(materialAmounts, density)
      if (massResult) {
        materialAmounts = massResult.materialAmounts
      }
    } else {
      const aggregateAmount = 2400 - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
      materialAmounts.sand = aggregateAmount * finalSandRatio
      materialAmounts.stone = aggregateAmount - materialAmounts.sand
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
      if (materials.sand && materials.sand.price) {
        materialCosts.sand = (materialAmounts.sand * materials.sand.price) / 1000
        totalCost += materialCosts.sand
      }
      if (materials.stone && materials.stone.price) {
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
      superplasticizerDosage: superplasticizerDosage.finalDosage,
      waterReducingRate,
      influenceFactor,
      calculationMethod: calculationMethod || 'absolute',
      slump // 包含用户输入的坍落度值
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

  // 模拟electron API
  window.electron = {
    ipcRenderer: {
      invoke: async (channel, data) => {
        // 模拟延迟
        await new Promise(resolve => setTimeout(resolve, 200))
        
        switch (channel) {
          case 'getAllMaterials':
            return { success: true, data: mockMaterials }
          case 'createMaterial':
            const newMaterial = { ...data, id: nextId++ }
            mockMaterials.push(newMaterial)
            return { success: true, data: newMaterial }
          case 'updateMaterial':
            const index = mockMaterials.findIndex(m => m.id === data.id)
            if (index !== -1) {
              mockMaterials[index] = { ...mockMaterials[index], ...data.data }
              return { success: true, data: mockMaterials[index] }
            }
            return { success: false, error: '材料不存在' }
          case 'deleteMaterial':
            mockMaterials = mockMaterials.filter(m => m.id !== data)
            return { success: true }
          case 'calculateMixDesign':
            try {
              const result = calculateMixDesignMock(data)
              return { success: true, data: result }
            } catch (error) {
              return { success: false, error: error.message }
            }
          case 'validateMixDesign':
            try {
              const result = validateMixDesignMock(data)
              return { success: true, data: result }
            } catch (error) {
              return { success: false, error: error.message }
            }
          case 'optimizeMixDesign':
            try {
              const result = optimizeMixDesignMock(data)
              return { success: true, data: result }
            } catch (error) {
              return { success: false, error: error.message }
            }
          case 'createMixDesign':
            const newScheme = { id: nextSchemeId++, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            mockSchemes.push(newScheme)
            return { success: true, data: newScheme }
          case 'getAllMixDesigns':
            return { success: true, data: mockSchemes }
          case 'getMixDesignById':
            const scheme = mockSchemes.find(s => s.id === data)
            if (scheme) {
              return { success: true, data: scheme }
            } else {
              return { success: false, error: '方案不存在' }
            }
          case 'deleteMixDesign':
            const deleteIndex = mockSchemes.findIndex(s => s.id === data)
            if (deleteIndex !== -1) {
              mockSchemes.splice(deleteIndex, 1)
              return { success: true }
            } else {
              return { success: false, error: '方案不存在' }
            }
          case 'updateMixDesign':
            const updateIndex = mockSchemes.findIndex(s => s.id === data.id)
            if (updateIndex !== -1) {
              mockSchemes[updateIndex] = { ...mockSchemes[updateIndex], ...data.data, updatedAt: new Date().toISOString() }
              return { success: true, data: mockSchemes[updateIndex] }
            } else {
              return { success: false, error: '方案不存在' }
            }
          default:
            return { success: false, error: '未知命令' }
        }
      },
      send: () => {},
      on: () => {},
      once: () => {},
      removeAllListeners: () => {}
    }
  }
  console.log('已加载模拟Electron API（包含完整JGJ 55标准计算），用于浏览器开发测试')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// 记录初始化完成
console.log('React应用已挂载到root元素')