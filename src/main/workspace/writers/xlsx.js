// xlsx writer：把 payload 序列化为 .xlsx（Buffer）
// payload: { title, sections: [{ type: 'table', sheetName?, rows, merges?, colWidths? }] }
// 输出：Promise<Buffer>
//
// - 每个 type==='table' 的 section 就是一个 sheet
// - sections 为空：建一个默认空 sheet
// - merges：[{ s: {r,c}, e: {r,c} }]
// - colWidths：[{ wch: number }] 或 直接 [number]
const xlsx = require('xlsx')

function normalizeColWidths(colWidths) {
  if (!Array.isArray(colWidths)) return undefined
  return colWidths.map(w => {
    if (typeof w === 'number') return { wch: w }
    if (w && typeof w === 'object' && typeof w.wch === 'number') return { wch: w.wch }
    return undefined
  }).filter(Boolean)
}

async function write(payload) {
  const title = (payload && payload.title) || 'untitled'
  const sections = (payload && Array.isArray(payload.sections)) ? payload.sections : []

  const wb = xlsx.utils.book_new()
  wb.Props = wb.Props || {}
  wb.Props.Title = title

  // 过滤所有 table section
  const tableSections = sections.filter(s => s && s.type === 'table')

  if (tableSections.length === 0) {
    // 必须建一个默认 sheet（xlsx 不允许空 workbook）
    const ws = xlsx.utils.aoa_to_sheet([[]])
    xlsx.utils.book_append_sheet(wb, ws, 'Sheet1')
  } else {
    tableSections.forEach((s, idx) => {
      const rows = Array.isArray(s.rows) ? s.rows : []
      const ws = xlsx.utils.aoa_to_sheet(rows)

      // 合并单元格
      if (Array.isArray(s.merges) && s.merges.length > 0) {
        ws['!merges'] = s.merges
      }

      // 列宽
      const cols = normalizeColWidths(s.colWidths)
      if (cols) {
        ws['!cols'] = cols
      }

      // sheet 名：去重 + 长度限制（Excel max 31 chars）
      let sheetName = s.sheetName || `Sheet${idx + 1}`
      sheetName = String(sheetName).slice(0, 31)
      // 防止重名：xlsx 库会拒绝同名
      let finalName = sheetName
      let suffix = 2
      const taken = new Set(wb.SheetNames || [])
      while (taken.has(finalName)) {
        const base = sheetName.slice(0, 31 - String(suffix).length - 1)
        finalName = `${base}_${suffix++}`
      }
      xlsx.utils.book_append_sheet(wb, ws, finalName)
    })
  }

  // xlsx.write → Buffer（Node 端）
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

module.exports = { write }