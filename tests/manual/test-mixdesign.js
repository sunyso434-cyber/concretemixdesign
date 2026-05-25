// 测试配合比计算功能
const MixDesignService = require('../../src/main/services/MixDesignService')

// 测试配置强度计算
function testTargetStrength() {
  console.log('=== 测试配置强度计算 ===')
  
  // 测试C30，σ=5.0
  const strength1 = 'C30'
  const stdDev1 = 5.0
  const targetStrength1 = MixDesignService.calculateTargetStrength(strength1, stdDev1)
  console.log(`${strength1}, σ=${stdDev1}: f_cu,0 = ${targetStrength1.toFixed(2)} MPa`)
  
  // 测试C20，σ=4.0
  const strength2 = 'C20'
  const stdDev2 = 4.0
  const targetStrength2 = MixDesignService.calculateTargetStrength(strength2, stdDev2)
  console.log(`${strength2}, σ=${stdDev2}: f_cu,0 = ${targetStrength2.toFixed(2)} MPa`)
  
  // 测试C50，σ=6.0
  const strength3 = 'C50'
  const stdDev3 = 6.0
  const targetStrength3 = MixDesignService.calculateTargetStrength(strength3, stdDev3)
  console.log(`${strength3}, σ=${stdDev3}: f_cu,0 = ${targetStrength3.toFixed(2)} MPa`)
}

// 测试水胶比计算
function testWaterRatio() {
  console.log('\n=== 测试水胶比计算 ===')
  
  // 测试C30，目标强度38.23 MPa
  const targetStrength = 38.23
  const cementStrength = 48.0
  const alphaA = 0.53
  const alphaB = 0.20
  
  // 使用正确的方法名（从81行开始的方法）
  const waterRatio = MixDesignService.calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
  console.log(`f_cu,0=${targetStrength.toFixed(2)} MPa, f_b=${cementStrength} MPa: W/B = ${waterRatio.toFixed(2)}`)
}

// 测试粗骨料最大粒径提取
function testExtractMaxAggregateSize() {
  console.log('\n=== 测试粗骨料最大粒径提取 ===')
  
  const testCases = [
    '5-25mm',
    '5-20mm',
    '10mm',
    '碎石',
    ''
  ]
  
  testCases.forEach(spec => {
    const maxSize = MixDesignService.extractMaxAggregateSize(spec)
    console.log(`规格"${spec}": 最大粒径 = ${maxSize}mm`)
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
    const waterAmount = MixDesignService.getBaseWaterAmount(test.maxSize, test.slump)
    console.log(`最大粒径${test.maxSize}mm, 坍落度${test.slump}mm: 用水量 = ${waterAmount}kg/m³`)
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
    const factor = MixDesignService.calculateInfluenceFactor(dosage, admixtureMaterial)
    console.log(`掺量${dosage}%: 影响系数 = ${factor.toFixed(3)}`)
  })
}

// 测试砂率计算
function testSandRatio() {
  console.log('\n=== 测试砂率计算 ===')
  
  const testSlumps = [40, 80, 120, 160, 200]
  
  testSlumps.forEach(slump => {
    const sandRatio = MixDesignService.calculateSandRatio(slump)
    console.log(`坍落度${slump}mm: 砂率 = ${(sandRatio * 100).toFixed(1)}%`)
  })
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
  
  console.log('=====================================')
  console.log('测试完成！')
}

// 运行测试
runAllTests()
