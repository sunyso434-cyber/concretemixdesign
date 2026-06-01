/**
 * 配合比→报价数据流测试
 * 测试数据一致性保障机制
 */

const MixDesignToQuoteService = require('../src/main/services/MixDesignToQuoteService')

// 模拟配合比设计结果（C30，180mm坍落度）
const mockMixDesignResult = {
  strengthGrade: 'C30',
  concreteType: '普通',
  slump: 180,
  materials: [
    { materialId: 1, materialType: '水泥', materialName: 'P·O 42.5R水泥', usage: 266.91 },
    { materialId: 2, materialType: '掺合料', materialName: 'I级粉煤灰', usage: 66.73 },
    { materialId: 3, materialType: '细骨料', materialName: '机制砂', usage: 951.02 },
    { materialId: 4, materialType: '粗骨料', materialName: '碎石', usage: 951.02 },
    { materialId: 5, materialType: '水', materialName: '水', usage: 157.92 },
    { materialId: 6, materialType: '外加剂', materialName: 'SSJS标准型减水剂', usage: 4.77 }
  ]
}

// 模拟定价参数
const mockPricing = {
  profitRate: 0.12,
  vatRate: 0.13,
  manufacturingFee: 18,
  technicalServiceFee: 0,
  transportDistance: 20,
  transportUnitPrice: 2.5,
  quoteRangeDelta: 5
}

console.log('=' .repeat(60))
console.log('配合比→报价数据流测试')
console.log('=' .repeat(60))

// 测试1：格式化配合比数据
console.log('\n【测试1】格式化配合比数据')
try {
  const formatted = MixDesignToQuoteService.formatMixDesignToBasicMix(mockMixDesignResult)
  console.log('✅ 格式化成功')
  console.log(`   强度等级: ${formatted.strengthGrade}`)
  console.log(`   坍落度: ${formatted.slump}mm`)
  console.log(`   材料数量: ${formatted.materials.length} 种`)
  formatted.materials.forEach(mat => {
    console.log(`   - ${mat.materialName}: ${mat.usage} kg`)
  })
} catch (error) {
  console.log('❌ 格式化失败:', error.message)
}

// 测试2：验证数据一致性（正常情况）
console.log('\n【测试2】验证数据一致性（正常情况）')
try {
  const basicMix = MixDesignToQuoteService.formatMixDesignToBasicMix(mockMixDesignResult)

  // 模拟正确的报价结果（数据一致）
  const correctQuoteResult = {
    materialDetails: mockMixDesignResult.materials.map(mat => ({
      materialId: mat.materialId,
      materialType: mat.materialType,
      materialName: mat.materialName,
      usage: mat.usage,
      unitPrice: 0.3,
      cost: mat.usage * 0.3 / 1000
    }))
  }

  const validation = MixDesignToQuoteService.validateQuoteConsistency(basicMix, correctQuoteResult)
  console.log(`✅ 验证结果: ${validation.valid ? '通过' : '失败'}`)
  console.log(`   匹配材料: ${validation.summary.matched} 种`)
  console.log(`   不匹配: ${validation.summary.mismatched} 种`)
  console.log(`   缺失: ${validation.summary.missing} 种`)
  console.log(`   多余: ${validation.summary.extra} 种`)
} catch (error) {
  console.log('❌ 验证失败:', error.message)
}

// 测试3：检测数据不一致（材料用量不同）
console.log('\n【测试3】检测数据不一致（材料用量不同）')
try {
  const basicMix = MixDesignToQuoteService.formatMixDesignToBasicMix(mockMixDesignResult)

  // 模拟错误的报价结果（水泥用量不同）
  const wrongQuoteResult = {
    materialDetails: mockMixDesignResult.materials.map(mat => ({
      materialId: mat.materialId,
      materialType: mat.materialType,
      materialName: mat.materialName,
      usage: mat.materialName === 'P·O 42.5R水泥' ? 248.83 : mat.usage, // 故意改错水泥用量
      unitPrice: 0.3,
      cost: mat.usage * 0.3 / 1000
    }))
  }

  const validation = MixDesignToQuoteService.validateQuoteConsistency(basicMix, wrongQuoteResult)
  console.log(`✅ 验证结果: ${validation.valid ? '通过' : '失败（符合预期）'}`)
  if (!validation.valid) {
    console.log('   发现的错误:')
    validation.errors.forEach(err => {
      console.log(`   ❌ ${err}`)
    })
  }
} catch (error) {
  console.log('❌ 验证失败:', error.message)
}

// 测试4：检测数据不一致（材料种类不同）
console.log('\n【测试4】检测数据不一致（材料种类不同）')
try {
  const basicMix = MixDesignToQuoteService.formatMixDesignToBasicMix(mockMixDesignResult)

  // 模拟错误的报价结果（多了矿渣粉，少了粉煤灰）
  const wrongQuoteResult = {
    materialDetails: [
      { materialName: 'P·O 42.5R水泥', usage: 266.91 },
      { materialName: 'S95矿渣粉', usage: 33.18 },  // 多了这个
      { materialName: '机制砂', usage: 951.02 },
      { materialName: '碎石', usage: 951.02 },
      { materialName: '水', usage: 157.92 },
      { materialName: 'SSJS标准型减水剂', usage: 4.77 }
      // 缺少粉煤灰
    ]
  }

  const validation = MixDesignToQuoteService.validateQuoteConsistency(basicMix, wrongQuoteResult)
  console.log(`✅ 验证结果: ${validation.valid ? '通过' : '失败（符合预期）'}`)
  if (!validation.valid) {
    console.log('   发现的错误:')
    validation.errors.forEach(err => {
      console.log(`   ❌ ${err}`)
    })
  }
} catch (error) {
  console.log('❌ 验证失败:', error.message)
}

// 测试5：生成对比报告
console.log('\n【测试5】生成对比报告')
try {
  const basicMix = MixDesignToQuoteService.formatMixDesignToBasicMix(mockMixDesignResult)

  const wrongQuoteResult = {
    materialDetails: [
      { materialName: 'P·O 42.5R水泥', usage: 248.83 },
      { materialName: 'I级粉煤灰', usage: 66.73 },
      { materialName: '机制砂', usage: 951.02 },
      { materialName: '碎石', usage: 951.02 },
      { materialName: '水', usage: 160.20 },
      { materialName: 'SSJS标准型减水剂', usage: 4.77 }
    ]
  }

  const report = MixDesignToQuoteService.generateConsistencyReport(basicMix, wrongQuoteResult)
  console.log(report)
} catch (error) {
  console.log('❌ 报告生成失败:', error.message)
}

console.log('\n' + '=' .repeat(60))
console.log('测试完成')
console.log('=' .repeat(60))
