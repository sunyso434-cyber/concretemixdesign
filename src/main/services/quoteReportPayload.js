/**
 * 报价单 → workspace_writeFile payload 转换
 * 按样例图片统一为 6 大块表格：材料 / 生产制造费 / 管理费 / 利税合计 / 运输泵送费 / 总计
 * 表格列：序号、计价项目、用量、单位、单价、金额、备注
 * reverse 模式在报价说明里体现包装策略，forward 模式体现设备费/技术服务费
 */

const POLISH_STRATEGY_NAME = {
  material_price: '材料单价包装（按价值占比分摊）',
  manufacturing: '制造费包装',
  labor: '人工费包装',
  none: '不包装（仅警告）'
}

const TABLE_HEADER = ['序号', '计价项目', '用量', '单位', '单价', '金额', '备注']

function money(value) {
  return Number(value || 0).toFixed(2)
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000
}

function modeLabel(mode) {
  return mode === 'reverse' ? '普通混凝土' : '特殊混凝土'
}

function buildMainTable(quote, mode) {
  const rows = [TABLE_HEADER]

  // 1. 材料
  rows.push(['1', '材料', '', '', '', '（材料费总计）', ''])
  ;(quote.materialDetails || []).forEach((item, idx) => {
    rows.push([
      `1.${idx + 1}`,
      item.materialName || item.materialType || '',
      String(item.usage ?? ''),
      'kg',
      money(item.unitPrice),
      money(item.cost),
      '（规格/厂家）'
    ])
  })

  // 2. 生产制造费
  rows.push(['2', '生产制造费', '', '', '', '（生产制造费总计）', ''])
  rows.push(['2.1', '制造费', '1', 'm³', '', money(quote.manufacturingFee), ''])
  rows.push(['2.2', '人工费', '1', 'm³', '', money(quote.laborFee), ''])
  rows.push(['2.3', '设备费', '1', 'm³', '', money(quote.equipmentFee ?? quote.equipmentUnitAmortization ?? 0), ''])

  // 3. 管理费
  rows.push(['3', '管理费', '', '', '', '（管理费总计）', ''])
  rows.push(['3.1', '销售费', '1', 'm³', '', money(quote.salesFee), ''])
  rows.push(['3.2', '技术服务费', '1', 'm³', '', money(quote.technicalServiceFee), ''])
  rows.push(['3.3', '财务费', '1', 'm³', '', money(quote.financeFee), ''])

  // 4. 利税合计
  rows.push(['4', '利税合计', '', '', '', '（利税合计）', ''])
  const profitAmount = mode === 'reverse'
    ? (quote.actualProfit ?? 0)
    : roundMoney((quote.totalCost ?? 0) * (quote.profitRange?.mid ?? 0.25))
  rows.push(['4.1', '利润', '1', 'm³', '', money(profitAmount), ''])
  rows.push(['4.2', '增值税', '1', 'm³', '', money(quote.vatAmount), ''])

  // 5. 运输泵送费
  rows.push(['5', '运输泵送费', '', '', '', '（运输泵送费总计）', ''])
  rows.push(['5.1', '运输费', quote.transportDistance || '', 'km', money(quote.transportUnitPrice), money(quote.transportFee), ''])
  rows.push(['5.2', '泵送费', '1', 'm³', '', money(quote.pumpingFee), '（泵送方式）'])

  // 6. 总计
  const totalAmount = mode === 'reverse' ? quote.suggestedDealPrice : quote.suggestedPrice
  rows.push(['6', '总计', '', '', '', money(totalAmount), ''])

  return rows
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
    { type: 'table', rows: buildMainTable(quote, m) },
    { type: 'h2', content: '报价说明' },
    { type: 'list', items: m === 'reverse' ? buildReverseNotes(quote) : buildForwardNotes(quote) }
  ]

  return { title, sections, metadata: { mode: m, generatedAt: new Date().toISOString() } }
}

module.exports = { quoteToReportPayload }
