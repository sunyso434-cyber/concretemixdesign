const fsp = require('fs').promises
const XLSX = require('xlsx')

function money(value) {
  return Number(value || 0).toFixed(2)
}

function setColumnWidths(ws, widths) {
  ws['!cols'] = widths
}

function buildInternalRows(quote, config = {}) {
  const rows = []
  if (config.companyName) {
    rows.push([config.companyName])
    rows.push([])
  }
  rows.push(
    ['内部核价单'],
    ['报价日期', new Date().toLocaleDateString('zh-CN')],
    ['强度等级', quote.strengthGrade],
    ['混凝土类型', quote.concreteType],
    ['坍落度(mm)', quote.slump || ''],
    [],
    ['材料成本明细'],
    ['材料类型', '材料名称', '单方用量(kg/m³)', '本次材料单价(元/吨)', '本次材料成本(元/m³)']
  )
  for (const item of quote.materialDetails || []) {
    rows.push([item.materialType, item.materialName, item.usage, item.unitPrice, money(item.cost)])
  }
  rows.push(
    [],
    ['材料成本小计(元/m³)', money(quote.materialCostSubtotal)],
    ['市场调价系数', `${Number(quote.marketAdjustmentRate || 0) * 100}%`],
    ['制造费(元/m³)', money(quote.manufacturingFee)],
    ['技术服务费(元/m³)', money(quote.technicalServiceFee)],
    ['成本构成小计(元/m³)', money(quote.costBase)],
    ['基础利润(元/m³)', money(quote.baseProfit)],
    [`运输费(${quote.transportDistance || 0}km × ${quote.transportUnitPrice || 0}元/km/m³)(元/m³)`, money(quote.transportFee)],
    ['税率', `${Number(quote.vatRate || 0) * 100}%`],
    ['税费(元/m³)', money(quote.vatAmount)],
    ['内部底线价(元/m³)', money(quote.internalFloorPrice)],
    ['建议成交价(元/m³)', money(quote.suggestedDealPrice)],
    ['建议报价区间(元/m³)', `${money(quote.quoteRange?.min)} - ${money(quote.quoteRange?.max)}`],
    [],
    ['泵送费（独立于混凝土单方价格）']
  )
  if (quote.pumpingFeeItems && quote.pumpingFeeItems.length > 0) {
    for (const item of quote.pumpingFeeItems) {
      rows.push([item.name, `${money(item.unitPrice)} 元/m³`])
    }
  } else {
    rows.push(['未选择泵送方式'])
  }
  return rows
}

function buildCustomerRows(quote, config = {}) {
  const rows = []
  if (config.companyName) {
    rows.push([config.companyName])
    rows.push([])
  }
  rows.push(
    ['混凝土报价单'],
    ['报价日期', new Date().toLocaleDateString('zh-CN')],
    ['强度等级', quote.strengthGrade],
    ['混凝土类型', quote.concreteType],
    ['坍落度(mm)', quote.slump || ''],
    [],
    ['材料用量及成本明细'],
    ['材料类型', '材料名称', '单方用量(kg/m³)', '单价(元/吨)', '成本(元/m³)']
  )
  for (const item of quote.materialDetails || []) {
    rows.push([item.materialType, item.materialName, item.usage, item.unitPrice, money(item.cost)])
  }
  rows.push(
    ['材料成本小计', money(quote.materialCostSubtotal)],
    [],
    ['费用构成'],
    ['材料成本', money(quote.materialCostSubtotal)],
    ['制造费', money(quote.manufacturingFee)],
    ['技术服务费', money(quote.technicalServiceFee)],
    [`运输费（${quote.transportDistance || 0}km）`, money(quote.transportFee)],
    ['税费（13%增值税）', money(quote.vatAmount)],
    ['单方报价', `${money(quote.suggestedDealPrice)} 元/m³`],
    [],
    ['报价说明'],
    ['含运输费（运距' + (quote.transportDistance || 0) + 'km）'],
    ['含13%增值税'],
    ['泵送费另附（详见泵送费报价单）'],
    ['本报价为单方报价，不含总数量和总金额']
  )
  return rows
}

function buildPumpingFeeRows(quote, config = {}) {
  const rows = []
  if (config.companyName) {
    rows.push([config.companyName])
    rows.push([])
  }
  rows.push(
    ['泵送费报价单'],
    ['报价日期', new Date().toLocaleDateString('zh-CN')],
    ['强度等级', quote.strengthGrade],
    ['混凝土类型', quote.concreteType],
    [],
    ['序号', '泵送方式', '单价(元/m³)']
  )
  if (quote.pumpingFeeItems && quote.pumpingFeeItems.length > 0) {
    quote.pumpingFeeItems.forEach((item, i) => {
      rows.push([i + 1, item.name, money(item.unitPrice)])
    })
  } else {
    rows.push([1, '未选择泵送方式', '0.00'])
  }
  return rows
}

async function exportQuoteToExcel({ filePath, quote, customerNote, companyName, companyContact, companyPhone }) {
  if (!filePath) throw new Error('缺少导出文件路径')
  if (!quote) throw new Error('缺少报价结果')

  const config = { companyName, companyContact, companyPhone, customerNote }
  const wb = XLSX.utils.book_new()

  const internalWs = XLSX.utils.aoa_to_sheet(buildInternalRows(quote, config))
  setColumnWidths(internalWs, [{ wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 16 }])
  XLSX.utils.book_append_sheet(wb, internalWs, '内部核价')

  const customerWs = XLSX.utils.aoa_to_sheet(buildCustomerRows(quote, config))
  setColumnWidths(customerWs, [{ wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 16 }])
  XLSX.utils.book_append_sheet(wb, customerWs, '客户报价')

  const pumpingWs = XLSX.utils.aoa_to_sheet(buildPumpingFeeRows(quote, config))
  setColumnWidths(pumpingWs, [{ wch: 8 }, { wch: 20 }, { wch: 14 }])
  XLSX.utils.book_append_sheet(wb, pumpingWs, '泵送费报价')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  await fsp.writeFile(filePath, buf)
  return { filePath }
}

module.exports = { exportQuoteToExcel, buildInternalRows, buildCustomerRows, buildPumpingFeeRows }
