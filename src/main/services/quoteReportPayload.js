/**
 * 报价单 → workspace_writeFile payload 转换
 * 9 块结构：材料成本 / 制造 / 人工 / 技术 / 运输 / 设备 / 利润 / 增值税 / 总价
 * reverse 模式在报价说明里体现包装策略，forward 模式体现设备费/技术服务费
 */

const POLISH_STRATEGY_NAME = {
  material_price: '材料单价包装（按价值占比分摊）',
  manufacturing: '制造费包装',
  labor: '人工费包装',
  none: '不包装（仅警告）'
}

function money(value) {
  return Number(value || 0).toFixed(2)
}

function modeLabel(mode) {
  return mode === 'reverse' ? '普通混凝土' : '特殊混凝土'
}

function buildMaterialTable(quote) {
  const rows = [['材料类型', '材料名称', '单方用量(kg/m³)', '单价(元/吨)', '小计(元/m³)']]
  for (const item of quote.materialDetails || []) {
    rows.push([
      item.materialType || '',
      item.materialName || '',
      String(item.usage ?? ''),
      money(item.unitPrice),
      money(item.cost)
    ])
  }
  rows.push(['', '', '', '小计', money(quote.materialCostSubtotal)])
  return rows
}

function buildFeeTable(quote) {
  const transportLabel = `运输费${quote.transportDistance ? `（${quote.transportDistance}km × ${money(quote.transportUnitPrice)}元/km/m³）` : ''}`
  return [
    ['费用项', '金额(元/m³)'],
    ['生产制造费', money(quote.manufacturingFee)],
    ['人工费', money(quote.laborFee)],
    ['技术服务费', money(quote.technicalServiceFee)],
    [transportLabel, money(quote.transportFee)],
    ['设备费', money(quote.equipmentFee ?? quote.equipmentUnitAmortization)]
  ]
}

function buildProfitSection(quote, mode) {
  if (mode === 'reverse') {
    const rate = (quote.actualProfitRate || 0) * 100
    return `利润：${money(quote.actualProfit)} 元/m³（按 ${rate.toFixed(2)}% 利润率，区间 [${((quote.profitSafeRange?.min || 0) * 100).toFixed(1)}%, ${((quote.profitSafeRange?.max || 0) * 100).toFixed(1)}%]）`
  }
  const pr = quote.profitRange || { min: 0.10, mid: 0.25, max: 0.40 }
  return `利润：按 ${(pr.min * 100).toFixed(0)}% / ${(pr.mid * 100).toFixed(1)}% / ${(pr.max * 100).toFixed(0)}% 三档议价`
}

function buildVatSection(quote) {
  const rate = (quote.vatRate || 0.13) * 100
  return `增值税：${money(quote.vatAmount)} 元/m³（按 ${rate.toFixed(0)}% 税率）`
}

function buildTotalSection(quote, mode) {
  if (mode === 'reverse') {
    return `总价（含税）：${money(quote.suggestedDealPrice)} 元/m³\n市场价定位：${money(quote.targetUnitPrice)} 元/m³`
  }
  return [
    `总价（含税，建议价）：${money(quote.suggestedPrice)} 元/m³`,
    `议价区间：最低 ${money(quote.minPrice)} | 建议 ${money(quote.suggestedPrice)} | 最高 ${money(quote.maxPrice)}`
  ].join('\n')
}

function buildReverseNotes(quote) {
  if (!quote.polished || !Array.isArray(quote.polishedUnitPrices) || quote.polishedUnitPrices.length === 0) {
    return ['本次报价未触发包装策略（实际利润率已在安全区间内）。']
  }
  const strategy = POLISH_STRATEGY_NAME[quote.polishStrategy] || quote.polishStrategy
  const lines = [`本次采用「${strategy}」策略：`]
  for (const p of quote.polishedUnitPrices) {
    const direction = p.polishedPrice > p.originalPrice ? '上调' : '下调'
    const pct = ((p.polishedPrice - p.originalPrice) / p.originalPrice * 100).toFixed(1)
    lines.push(`- ${p.materialName || ''}：${money(p.originalPrice)} → ${money(p.polishedPrice)} 元/吨（${direction} ${pct}%）${p.clamped ? ' ⚠ 已按边界钳制' : ''}`)
  }
  lines.push('其余材料单价保持不变，使总成本合理化以符合市价定位。')
  if (quote.warning) lines.push(`⚠ 注意：${quote.warning}`)
  return lines
}

function buildForwardNotes(quote) {
  const lines = []
  if (quote.equipmentAmortization) {
    const eq = quote.equipmentAmortization
    lines.push(`设备费说明：新购设备成本 ${money(eq.purchaseCost)} 元，预计总摊销 ${eq.totalAmortizeVolume} m³，按 ${money(quote.equipmentUnitAmortization)} 元/m³ 计入单方成本${eq.currentOrderVolume ? `；本次订单 ${eq.currentOrderVolume} m³ 总摊销 ${money(quote.equipmentTotalAmortization)} 元` : ''}。`)
  }
  if (Number(quote.technicalServiceFee) > 0) {
    lines.push(`技术服务费说明：含 ${money(quote.technicalServiceFee)} 元/m³ 的现场技术指导 / 配合比调整 / 强度保压等服务。`)
  }
  if (lines.length === 0) lines.push('本次报价为特殊混凝土正向测算，未含设备费和技术服务费特别说明。')
  return lines
}

function quoteToReportPayload(quote, mode) {
  if (!quote) throw new Error('缺少 quote 对象')
  const m = mode || quote.mode || 'reverse'
  const title = `${quote.strengthGrade || ''} ${modeLabel(m)}报价单`

  const sections = [
    { type: 'h1', content: title },
    { type: 'p', content: `报价日期：${new Date().toLocaleDateString('zh-CN')}    金额单位：元/m³` },
    { type: 'h2', content: '1. 材料成本（含明细）' },
    { type: 'table', rows: buildMaterialTable(quote) },
    { type: 'h2', content: '2-6. 各项费用' },
    { type: 'table', rows: buildFeeTable(quote) },
    { type: 'h2', content: '7. 利润' },
    { type: 'p', content: buildProfitSection(quote, m) },
    { type: 'h2', content: '8. 增值税' },
    { type: 'p', content: buildVatSection(quote) },
    { type: 'h2', content: '9. 总价' },
    { type: 'p', content: buildTotalSection(quote, m) },
    { type: 'h2', content: '报价说明' },
    { type: 'list', items: m === 'reverse' ? buildReverseNotes(quote) : buildForwardNotes(quote) }
  ]

  return { title, sections, metadata: { mode: m, generatedAt: new Date().toISOString() } }
}

module.exports = { quoteToReportPayload }
