/**
 * 端到端冒烟测试：复现老板 2026-06-08 报告的 bug
 *
 * 链路：materialDetails 缺失的方案 → save_to_basic_mix_library → calculate_sales_quote
 * 期望：报价正常算出，不抛"水泥没有单价，无法准确报价"
 *
 * 关键修复点（任一缺失即视为回归）：
 *   1. save_to_basic_mix_library 使用 buildBasicMixMaterials 兜底反查 materialId
 *   2. buildBasicMixMaterials 在 materialDetails 缺失时按 type/name 反查 id
 */

const path = require('path')
const assert = require('assert')

// 直接 require 关键模块（不依赖 aiAnalysisHandler 的工具链）
const { buildBasicMixMaterials } = require(path.join(__dirname, '..', '..', 'src', 'main', 'utils', 'buildBasicMixMaterials'))
const SalesQuoteCalculationService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'SalesQuoteCalculationService'))

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

// 老板的 C30 案例（2026-06-08）：锂渣 12% + 复合粉 12%，P·O 42.5R + 机制砂 + 碎石
const materialLib = [
  { id: 25, name: 'P·O 42.5R水泥（拉法基）', type: '水泥', price: 300 },
  { id: 40, name: '锂渣（青白江）', type: '锂渣', price: 65 },
  { id: 41, name: '复合粉（拉法基）', type: '复合粉', price: 110 },
  { id: 7, name: '机制砂（汶川）', type: '细骨料', price: 89 },
  { id: 9, name: '碎石（汶川5-25mm）', type: '粗骨料', price: 85 },
  { id: 11, name: 'SSJS（同升）', type: '减水剂', price: 1400 },
  { id: 100, name: '水', type: '其他', price: 0 }
]

// 模拟 mix-design.js 保存草稿的 result（只含用量，没存 materialDetails）
const schemeMaterials = {
  water: 164.11,
  cement: 274.67,
  lithiumSlag: 43.37,
  compositePowder: 43.37,
  sand: 839.00,
  stone: 1028.29,
  superplasticizer: 5.17
}
const schemeSelected = {} // 模拟 bug：materialDetails 缺失
const fineBreakdown = []
const coarseBreakdown = []

run('端到端：materialDetails 缺失方案 → 存基准库 → 报价（老板 C30 案例）', () => {
  // 1. 模拟 save_to_basic_mix_library 的转换过程
  const basicMixMaterials = buildBasicMixMaterials({
    materials: schemeMaterials,
    selected: schemeSelected,
    fineBreakdown,
    coarseBreakdown,
    allMaterials: materialLib
  })

  // 关键断言：所有 materialId 都必须反查成功
  for (const m of basicMixMaterials) {
    assert.notStrictEqual(m.materialId, null, `${m.materialType} 的 materialId 反查失败（不应为 null）`)
  }

  // 2. 模拟 calculate_sales_quote：把 materialId 对应的 price 填进去
  const pricesById = new Map(materialLib.map(m => [m.id, m.price]))
  const waterMat = materialLib.find(m => m.name === '水')
  const basicMix = {
    strengthGrade: 'C30',
    concreteType: '普通',
    slump: 180,
    materials: basicMixMaterials.map(item => ({
      ...item,
      price: item.materialId != null ? pricesById.get(item.materialId) : (item.materialType === '水' ? waterMat?.price : undefined)
    }))
  }

  // 3. 跑报价计算（关键：必须不抛"水泥没有单价"）
  const quote = SalesQuoteCalculationService.calculate({
    basicMix,
    pricing: {
      profitRate: 0.12,
      vatRate: 0.13,
      manufacturingFee: 18,
      technicalServiceFee: 0,
      transportDistance: 20,
      transportUnitPrice: 2.5,
      quoteRangeDelta: 5
    }
  })

  // 4. 验证报价合理性
  assert.strictEqual(quote.strengthGrade, 'C30')
  assert.ok(quote.suggestedDealPrice > 300, `含税价应 > 300 元/m³，实际 ${quote.suggestedDealPrice}`)
  assert.ok(quote.suggestedDealPrice < 600, `含税价应 < 600 元/m³，实际 ${quote.suggestedDealPrice}`)
  // 材料成本应包含水泥+锂渣+复合粉+砂+石+减水剂
  const cement = quote.materialDetails.find(m => m.materialType === '水泥')
  assert.ok(cement, '报价应包含水泥')
  assert.strictEqual(cement.unitPrice, 300, '水泥单价应为 300 元/t')
  console.log(`  → 报价: ${quote.suggestedDealPrice.toFixed(2)} 元/m³ (材料成本 ${quote.materialCostSubtotal.toFixed(2)} 元/m³)`)
})

run('回归：materialDetails 完整时报价逻辑不变（首选路径）', () => {
  const basicMixMaterials = buildBasicMixMaterials({
    materials: schemeMaterials,
    selected: {
      cement: { id: 25, name: 'P·O 42.5R水泥（拉法基）' },
      lithiumSlag: { id: 40, name: '锂渣（青白江）' },
      compositePowder: { id: 41, name: '复合粉（拉法基）' },
      sand: { id: 7, name: '机制砂（汶川）' },
      stone: { id: 9, name: '碎石（汶川5-25mm）' },
      superplasticizer: { id: 11, name: 'SSJS（同升）' }
    },
    fineBreakdown,
    coarseBreakdown,
    allMaterials: materialLib
  })
  // 应当走首选路径，id 都是预期的
  const byType = Object.fromEntries(basicMixMaterials.map(m => [m.materialType, m]))
  assert.strictEqual(byType['水泥'].materialId, 25)
  assert.strictEqual(byType['锂渣'].materialId, 40)
  assert.strictEqual(byType['复合粉'].materialId, 41)
  assert.strictEqual(byType['细骨料'].materialId, 7)
  assert.strictEqual(byType['粗骨料'].materialId, 9)
  assert.strictEqual(byType['减水剂'].materialId, 11)
})

run('回归：极端情况（空材料库 + 空 selected）不抛错', () => {
  const result = buildBasicMixMaterials({
    materials: { cement: 274, water: 160 },
    selected: {},
    allMaterials: []
  })
  assert.strictEqual(result.length, 2)
  // 不抛错即可，id 允许为 null
})
