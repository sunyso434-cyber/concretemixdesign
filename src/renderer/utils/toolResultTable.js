/**
 * v0.9.x 输出优化：工具结果 → antd Table 数据转换
 *
 * 识别结果中的"表格形"数组（result 本身 / items / rows / data / list / records），
 * 列取前 8 个键、行限 50 条，防止大结果渲染卡顿；
 * 非表格形（字符串、标量、嵌套无数组）返回 null，调用方保持人话摘要。
 */
export function resultToTableData(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null

  const candidates = [result.materials, result.items, result.rows, result.data, result.list, result.records, result.mixDesigns, result.schemes, result.results, result.fineAggregateBreakdown, result.coarseAggregateBreakdown, result.calculationSteps]
  let rows = null
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && c[0] !== null && typeof c[0] === 'object' && !Array.isArray(c[0])) {
      rows = c
      break
    }
  }
  if (!rows) return null

  rows = rows.slice(0, 50)
  const keys = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    for (const k of Object.keys(r)) {
      if (!keys.includes(k)) keys.push(k)
    }
  }
  const cols = keys.slice(0, 8)
  if (cols.length === 0) return null

  const columns = cols.map(k => ({ title: k, dataIndex: k, key: k }))
  const data = rows.map((r, i) => {
    const row = { key: i }
    for (const k of cols) {
      let v = r ? r[k] : undefined
      if (v !== null && typeof v === 'object') v = JSON.stringify(v)
      row[k] = v === null || v === undefined ? '' : String(v)
    }
    return row
  })
  return { columns, data }
}
