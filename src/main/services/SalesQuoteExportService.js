const fsp = require('fs').promises
const XLSX = require('xlsx')

function money(value) {
  return Number(value || 0).toFixed(2)
}

function buildInternalRows(quote) {
  const rows = [
    ['内部核价'],
    ['强度等级', quote.strengthGrade],
    ['混凝土类型', quote.concreteType],
    ['坍落度(mm)', quote.slump || ''],
    [],
    ['材料成本明细'],
    ['材料类型', '材料名称', '单方用量(kg/m³)', '本次材料单价(元/吨)', '本次材料成本(元/m³)']
  ]
  for (const item of quote.materialDetails || []) {
    rows.push([item.materialType, item.materialName, item.usage, item.unitPrice, money(item.cost)])
  }
  rows.push(
    [],
    ['材料成本小计(元/m³)', money(quote.materialCostSubtotal)],
    ['制造费(元/m³)', money(quote.manufacturingFee)],
    ['技术服务费(元/m³)', money(quote.technicalServiceFee)],
    ['运输费(元/m³)', money(quote.transportFee)],
    ['泵送费(元/m³)', money(quote.pumpingFee)],
    ['税率', `${Number(quote.vatRate || 0) * 100}%`],
    ['税费(元/m³)', money(quote.vatAmount)],
    ['内部底线价(元/m³)', money(quote.internalFloorPrice)],
    ['建议成交价(元/m³)', money(quote.suggestedDealPrice)],
    ['建议报价区间(元/m³)', `${money(quote.quoteRange?.min)} - ${money(quote.quoteRange?.max)}`]
  )
  return rows
}

function buildCustomerRows(quote, customerNote) {
  return [
    ['客户报价'],
    ['强度等级', quote.strengthGrade],
    ['混凝土类型', quote.concreteType],
    ['坍落度(mm)', quote.slump || ''],
    ['单方报价(元/m³)', money(quote.suggestedDealPrice)],
    ['报价说明', customerNote || '本报价为单方报价，含运输费、泵送费和13%增值税。'],
    ['备注', `报价${quote.includes?.transport ? '含' : '不含'}运输费，${quote.includes?.pumping ? '含' : '不含'}泵送费，${quote.includes?.vat ? '含13%增值税' : '不含税'}。`]
  ]
}

async function exportQuoteToExcel({ filePath, quote, customerNote }) {
  if (!filePath) throw new Error('缺少导出文件路径')
  if (!quote) throw new Error('缺少报价结果')

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildInternalRows(quote)), '内部核价')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildCustomerRows(quote, customerNote)), '客户报价')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  await fsp.writeFile(filePath, buf)
  return { filePath }
}

module.exports = { exportQuoteToExcel, buildInternalRows, buildCustomerRows }