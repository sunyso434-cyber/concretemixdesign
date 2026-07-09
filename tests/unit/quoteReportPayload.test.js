const assert = require('assert')
const path = require('path')

const { quoteToReportPayload } = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'services',
  'quoteReportPayload'
))

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

const baseQuote = {
  strengthGrade: 'C30',
  concreteType: '普通',
  slump: 180,
  materialDetails: [
    { materialId: 1, materialType: '水泥', materialName: 'P.O 42.5', usage: 320, unitPrice: 360, cost: 115.2 },
    { materialId: 2, materialType: '粉煤灰', materialName: 'II级粉煤灰', usage: 60, unitPrice: 180, cost: 10.8 },
    { materialId: 3, materialType: '细骨料', materialName: '机制砂', usage: 780, unitPrice: 95, cost: 74.1 },
    { materialId: 4, materialType: '粗骨料', materialName: '碎石', usage: 1040, unitPrice: 80, cost: 83.2 },
    { materialId: 5, materialType: '减水剂', materialName: '聚羧酸', usage: 7.6, unitPrice: 4200, cost: 31.92 }
  ],
  materialCostSubtotal: 315.22,
  manufacturingFee: 18,
  laborFee: 10,
  technicalServiceFee: 0,
  salesFee: 0,
  financeFee: 0,
  transportDistance: 20,
  transportUnitPrice: 2.5,
  transportFee: 50,
  pumpingFee: 0,
  equipmentFee: 0,
  vatRate: 0.13,
  vatAmount: 54.94
}

run('reverse payload has 6-block table with correct header', () => {
  const quote = {
    ...baseQuote,
    mode: 'reverse',
    totalCost: 393.22,
    actualProfit: 5.89,
    actualProfitRate: 0.015,
    suggestedDealPrice: 450.55,
    targetUnitPrice: 450.55,
    profitSafeRange: { min: 0.005, max: 0.03 },
    polished: false,
    polishStrategy: 'material_price',
    polishedUnitPrices: []
  }
  const payload = quoteToReportPayload(quote, 'reverse')
  assert.ok(payload.title.includes('C30'))
  assert.ok(payload.title.includes('普通混凝土'))

  const table = payload.sections.find(s => s.type === 'table')
  assert.ok(table, '缺少 table section')
  assert.deepStrictEqual(table.rows[0], ['序号', '计价项目', '用量', '单位', '单价', '金额', '备注'])

  // 6 大块汇总行
  assert.strictEqual(table.rows[1][0], '1')
  assert.strictEqual(table.rows[1][1], '材料')
  assert.strictEqual(table.rows.find(r => r[1] === '生产制造费')[0], '2')
  assert.strictEqual(table.rows.find(r => r[1] === '管理费')[0], '3')
  assert.strictEqual(table.rows.find(r => r[1] === '利税合计')[0], '4')
  assert.strictEqual(table.rows.find(r => r[1] === '运输泵送费')[0], '5')
  assert.strictEqual(table.rows.find(r => r[1] === '总计')[0], '6')

  // 材料子项
  assert.ok(table.rows.some(r => r[1] === 'P.O 42.5'))
  assert.ok(table.rows.some(r => r[1] === '碎石'))

  // 总计金额
  const totalRow = table.rows.find(r => r[1] === '总计')
  assert.strictEqual(totalRow[5], '450.55')

  // 报价说明保留
  const notesSection = payload.sections.find(s => s.type === 'h2' && s.content === '报价说明')
  assert.ok(notesSection)
})

run('forward payload has 6-block table and profit uses mid range', () => {
  const quote = {
    ...baseQuote,
    mode: 'forward',
    totalCost: 393.22,
    profitRange: { min: 0.10, mid: 0.25, max: 0.40 },
    minPrice: 487.35,
    suggestedPrice: 553.81,
    maxPrice: 620.26
  }
  const payload = quoteToReportPayload(quote, 'forward')
  const table = payload.sections.find(s => s.type === 'table').rows

  const profitRow = table.find(r => r[1] === '利润')
  assert.strictEqual(profitRow[5], '98.31')

  const totalRow = table.find(r => r[1] === '总计')
  assert.strictEqual(totalRow[5], '553.81')
})

run('salesFee / financeFee / pumpingFee appear in management and transport sections', () => {
  const quote = {
    ...baseQuote,
    mode: 'reverse',
    salesFee: 5,
    financeFee: 3,
    pumpingFee: 12,
    totalCost: 413.22,
    actualProfit: 5.89,
    suggestedDealPrice: 472.16,
    targetUnitPrice: 472.16,
    profitSafeRange: { min: 0.005, max: 0.03 },
    polished: false,
    polishStrategy: 'material_price',
    polishedUnitPrices: []
  }
  const table = quoteToReportPayload(quote, 'reverse').sections.find(s => s.type === 'table').rows

  const salesRow = table.find(r => r[1] === '销售费')
  assert.strictEqual(salesRow[5], '5.00')

  const financeRow = table.find(r => r[1] === '财务费')
  assert.strictEqual(financeRow[5], '3.00')

  const pumpingRow = table.find(r => r[1] === '泵送费')
  assert.strictEqual(pumpingRow[5], '12.00')
})
