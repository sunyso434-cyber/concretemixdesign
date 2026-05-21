const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const XLSX = require('xlsx')

const SalesQuoteExportService = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'services',
  'SalesQuoteExportService'
))

async function run(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

run('exports internal and customer quote sheets', async () => {
  const filePath = path.join(os.tmpdir(), `sales-quote-${Date.now()}.xlsx`)
  await SalesQuoteExportService.exportQuoteToExcel({
    filePath,
    quote: {
      strengthGrade: 'C35',
      concreteType: '抗渗',
      slump: 180,
      materialDetails: [
        { materialType: '水泥', materialName: 'P.O 42.5', usage: 320, unitPrice: 360, cost: 115.2 }
      ],
      materialCostSubtotal: 115.2,
      manufacturingFee: 18,
      technicalServiceFee: 20,
      transportFee: 12,
      pumpingFee: 15,
      vatRate: 0.13,
      vatAmount: 23.426,
      internalFloorPrice: 180.2,
      suggestedDealPrice: 203.626,
      quoteRange: { min: 198.626, max: 208.626 },
      includes: { transport: true, pumping: true, vat: true }
    },
    customerNote: '含运输费、泵送费和13%增值税。'
  })

  const wb = XLSX.readFile(filePath)
  assert.deepStrictEqual(wb.SheetNames, ['内部核价', '客户报价'])

  const internalRows = XLSX.utils.sheet_to_json(wb.Sheets['内部核价'], { header: 1 })
  const customerRows = XLSX.utils.sheet_to_json(wb.Sheets['客户报价'], { header: 1 })
  assert.ok(internalRows.flat().includes('材料成本明细'))
  assert.ok(internalRows.flat().includes('本次材料单价(元/吨)'))
  assert.ok(customerRows.flat().includes('单方报价(元/m³)'))
  assert.ok(!customerRows.flat().includes('内部底线价'))

  fs.unlinkSync(filePath)
})