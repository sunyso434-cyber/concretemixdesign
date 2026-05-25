// 测试核心配合比计算函数

// 1. 配置强度计算
function calculateTargetStrength(strength, stdDev) {
  const strengthNum = parseInt(strength.replace('C', ''))
  return strengthNum + 1.645 * stdDev
}

// 2. 水胶比计算
function calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB) {
  const numerator = alphaA * cementStrength
  const denominator = targetStrength + alphaA * alphaB * cementStrength
  return numerator / denominator
}

// 3. 粗骨料最大粒径提取
function extractMaxAggregateSize(specification) {
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

// 4. 基准用水量计算
function getBaseWaterAmount(maxSize, slump) {
  const waterTable = {
    10: { low: 190, high: 240 },
    16: { low: 180, high: 230 },
    20: { low: 170, high: 220 },
    25: { low: 160, high: 210 },
    31.5: { low: 155, high: 205 },
    37.5: { low: 150, high: 200 }
  }
  
  const sizes = Object.keys(waterTable).map(Number).sort((a, b) => a - b)
  let closestSize = sizes[0]
  for (const size of sizes) {
    if (maxSize >= size) {
      closestSize = size
    }
  }
  
  const range = waterTable[closestSize]
  const slumpRange = slump - 10
  const totalRange = 190 - 10
  const waterRange = range.high - range.low
  
  let waterAmount = range.low + (slumpRange / totalRange) * waterRange
  waterAmount = Math.max(range.low, Math.min(range.high, waterAmount))
  
  return Math.round(waterAmount)
}

// 5. 砂率计算
function calculateSandRatio(slump) {
  if (slump <= 80) return 0.38
  else if (slump <= 120) return 0.40
  else if (slump <= 160) return 0.42
  else return 0.44
}

// 6. 掺合料影响系数计算
function calculateInfluenceFactor(admixtureDosage, admixtureMaterial) {
  const dosageLevels = [10, 20, 30, 40, 50]
  const factors = {
    10: admixtureMaterial?.influenceFactor_10 || 1.0,
    20: admixtureMaterial?.influenceFactor_20 || 1.0,
    30: admixtureMaterial?.influenceFactor_30 || 1.05,
    40: admixtureMaterial?.influenceFactor_40 || 1.1,
    50: admixtureMaterial?.influenceFactor_50 || 1.15
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
  
  return finalFactor
}

// 7. 减水剂掺量计算
function calculateSuperplasticizerDosage(strength, fineAggregateMaterial) {
  const baseMbValue = 0.5
  const baseFinenessModulus = 2.7
  
  const strengthNum = parseInt(strength.replace('C', ''))
  const baseStrength = 30
  const baseDosage = 1.8
  const difference = (strengthNum - baseStrength) / 5
  let finalDosage = baseDosage + difference * 0.1
  
  if (fineAggregateMaterial) {
    const mbValue = fineAggregateMaterial.mbValue || baseMbValue
    const finenessModulus = fineAggregateMaterial.finenessModulus || baseFinenessModulus
    
    const mbAdjustment = Math.max(0, mbValue - baseMbValue) / 0.1 * 0.1
    const fmAdjustment = Math.max(0, baseFinenessModulus - finenessModulus) / 0.1 * 0.1
    
    finalDosage += mbAdjustment + fmAdjustment
  }
  
  return finalDosage
}

// 8. 减水率计算
function calculateWaterReducingRate(baseReducingRate, baseDosage, finalDosage, ratePer01) {
  const dosageDiff = finalDosage - baseDosage
  const rateAdjustment = (dosageDiff / 0.1) * ratePer01
  return baseReducingRate + rateAdjustment
}

// 9. 质量法计算
function calculateByMassMethod(materialAmounts, targetDensity = 2400) {
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

// 测试配置强度计算
function testTargetStrength() {
  console.log('=== 测试配置强度计算 ===')
  
  const testCases = [
    { strength: 'C30', stdDev: 5.0, expected: 38.23 },
    { strength: 'C20', stdDev: 4.0, expected: 26.58 },
    { strength: 'C50', stdDev: 6.0, expected: 59.87 }
  ]
  
  testCases.forEach(test => {
    const result = calculateTargetStrength(test.strength, test.stdDev)
    const passed = Math.abs(result - test.expected) < 0.01
    console.log(`${test.strength}, σ=${test.stdDev}: f_cu,0 = ${result.toFixed(2)} MPa ${passed ? '✓' : '✗'}`)
  })
}

// 测试水胶比计算
function testWaterRatio() {
  console.log('\n=== 测试水胶比计算 ===')
  
  const testCases = [
    { targetStrength: 38.23, cementStrength: 48.0, alphaA: 0.53, alphaB: 0.20 }
  ]
  
  testCases.forEach(test => {
    const result = calculateWaterRatio(test.targetStrength, test.cementStrength, test.alphaA, test.alphaB)
    console.log(`f_cu,0=${test.targetStrength.toFixed(2)} MPa, f_b=${test.cementStrength} MPa: W/B = ${result.toFixed(2)}`)
  })
}

// 测试粗骨料最大粒径提取
function testExtractMaxAggregateSize() {
  console.log('\n=== 测试粗骨料最大粒径提取 ===')
  
  const testCases = [
    { spec: '5-25mm', expected: 25 },
    { spec: '5-20mm', expected: 20 },
    { spec: '10mm', expected: 10 },
    { spec: '碎石', expected: 20 },
    { spec: '', expected: 20 }
  ]
  
  testCases.forEach(test => {
    const result = extractMaxAggregateSize(test.spec)
    const passed = result === test.expected
    console.log(`规格"${test.spec}": 最大粒径 = ${result}mm ${passed ? '✓' : '✗'}`)
  })
}

// 测试基准用水量计算
function testBaseWaterAmount() {
  console.log('\n=== 测试基准用水量计算 ===')
  
  const testCases = [
    { maxSize: 25, slump: 120 },
    { maxSize: 20, slump: 80 },
    { maxSize: 16, slump: 160 },
    { maxSize: 31.5, slump: 50 }
  ]
  
  testCases.forEach(test => {
    const result = getBaseWaterAmount(test.maxSize, test.slump)
    console.log(`最大粒径${test.maxSize}mm, 坍落度${test.slump}mm: 用水量 = ${result}kg/m³`)
  })
}

// 测试掺合料影响系数计算
function testInfluenceFactor() {
  console.log('\n=== 测试掺合料影响系数计算 ===')
  
  const admixtureMaterial = {
    influenceFactor_10: 1.0,
    influenceFactor_20: 1.0,
    influenceFactor_30: 1.05,
    influenceFactor_40: 1.1,
    influenceFactor_50: 1.15
  }
  
  const testDosages = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
  
  testDosages.forEach(dosage => {
    const result = calculateInfluenceFactor(dosage, admixtureMaterial)
    console.log(`掺量${dosage}%: 影响系数 = ${result.toFixed(3)}`)
  })
}

// 测试砂率计算
function testSandRatio() {
  console.log('\n=== 测试砂率计算 ===')
  
  const testSlumps = [40, 80, 120, 160, 200]
  
  testSlumps.forEach(slump => {
    const result = calculateSandRatio(slump)
    console.log(`坍落度${slump}mm: 砂率 = ${(result * 100).toFixed(1)}%`)
  })
}

// 测试减水剂掺量计算
function testSuperplasticizerDosage() {
  console.log('\n=== 测试减水剂掺量计算 ===')
  
  const fineAggregateMaterial = {
    mbValue: 0.8,
    finenessModulus: 2.4
  }
  
  const testCases = ['C20', 'C30', 'C40']
  
  testCases.forEach(strength => {
    const result = calculateSuperplasticizerDosage(strength, fineAggregateMaterial)
    console.log(`${strength}混凝土: 减水剂掺量 = ${result.toFixed(2)}%`)
  })
}

// 测试完整配合比计算
function testCompleteMixDesign() {
  console.log('\n=== 测试完整配合比计算 ===')
  
  const params = {
    strength: 'C30',
    slump: 120,
    calculationMethod: 'absolute',
    admixtureDosage: 20,
    customSandRatio: null
  }
  
  // 1. 配置强度计算
  const stdDev = 5.0
  const targetStrength = calculateTargetStrength(params.strength, stdDev)
  console.log(`配置强度: ${targetStrength.toFixed(2)} MPa`)
  
  // 2. 水胶比计算
  const cementStrength = 48.0
  const alphaA = 0.53
  const alphaB = 0.20
  const waterRatio = calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
  console.log(`水胶比: ${waterRatio.toFixed(2)}`)
  
  // 3. 基准用水量
  const maxSize = 25
  const baseWaterAmount = getBaseWaterAmount(maxSize, params.slump)
  console.log(`基准用水量: ${baseWaterAmount} kg/m³`)
  
  // 4. 减水剂掺量
  const fineAggregateMaterial = { mbValue: 0.5, finenessModulus: 2.7 }
  const superplasticizerDosage = calculateSuperplasticizerDosage(params.strength, fineAggregateMaterial)
  console.log(`减水剂掺量: ${superplasticizerDosage.toFixed(2)}%`)
  
  // 5. 减水率
  const baseReducingRate = 25
  const baseDosage = 1.8
  const ratePer01 = 2.0
  const waterReducingRate = calculateWaterReducingRate(baseReducingRate, baseDosage, superplasticizerDosage, ratePer01)
  console.log(`减水率: ${waterReducingRate.toFixed(1)}%`)
  
  // 6. 实际用水量
  const waterAmount = baseWaterAmount * (1 - waterReducingRate / 100)
  console.log(`实际用水量: ${waterAmount.toFixed(1)} kg/m³`)
  
  // 7. 胶凝材料总量
  const cementitiousAmount = waterAmount / waterRatio
  console.log(`胶凝材料总量: ${cementitiousAmount.toFixed(1)} kg/m³`)
  
  // 8. 砂率
  const sandRatio = calculateSandRatio(params.slump)
  console.log(`砂率: ${(sandRatio * 100).toFixed(1)}%`)
  
  // 9. 材料用量
  const materialAmounts = {
    water: waterAmount,
    cement: cementitiousAmount * 0.7,
    flyAsh: cementitiousAmount * 0.2,
    slag: cementitiousAmount * 0.1,
    sand: 0,
    stone: 0,
    superplasticizer: cementitiousAmount * (superplasticizerDosage / 100)
  }
  
  // 10. 骨料用量
  const aggregateAmount = 2400 - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
  materialAmounts.sand = aggregateAmount * sandRatio
  materialAmounts.stone = aggregateAmount - materialAmounts.sand
  
  console.log('\n材料用量:')
  console.log(`水泥: ${materialAmounts.cement.toFixed(1)} kg/m³`)
  console.log(`粉煤灰: ${materialAmounts.flyAsh.toFixed(1)} kg/m³`)
  console.log(`矿渣粉: ${materialAmounts.slag.toFixed(1)} kg/m³`)
  console.log(`砂: ${materialAmounts.sand.toFixed(1)} kg/m³`)
  console.log(`石: ${materialAmounts.stone.toFixed(1)} kg/m³`)
  console.log(`水: ${materialAmounts.water.toFixed(1)} kg/m³`)
  console.log(`减水剂: ${materialAmounts.superplasticizer.toFixed(1)} kg/m³`)
  
  // 11. 容重
  const density = Object.values(materialAmounts).reduce((sum, amount) => sum + amount, 0)
  console.log(`\n容重: ${density.toFixed(1)} kg/m³`)
}

// 运行所有测试
function runAllTests() {
  console.log('开始测试配合比计算功能...')
  console.log('=====================================')
  
  testTargetStrength()
  testWaterRatio()
  testExtractMaxAggregateSize()
  testBaseWaterAmount()
  testInfluenceFactor()
  testSandRatio()
  testSuperplasticizerDosage()
  testCompleteMixDesign()
  
  console.log('=====================================')
  console.log('测试完成！')
}

// 运行测试
runAllTests()
