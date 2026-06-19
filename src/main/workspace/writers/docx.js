// docx writer：把 payload 序列化为 .docx（Buffer）
// payload: { title, sections: [{ type: 'h1'|'h2'|'p'|'table'|'list'|'code', content|rows|items|code }] }
// 输出：Promise<Buffer>（Packer.toBuffer）
//
// - h1/h2/p：对应 HeadingLevel.HEADING_1/2 或普通段落
// - list：每个 item 一个带 bullet 的段落
// - code：等宽字体 + 浅灰背景
// - table：2D rows → Table/TableRow/TableCell
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ShadingType
} = require('docx')

/**
 * 把单个 section 转成 docx 节点数组（一个 section 可能产出多个 children，比如 list）
 */
function renderSection(section) {
  if (!section || typeof section !== 'object') return []
  switch (section.type) {
    case 'h1':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(String(section.content || ''))]
      })]
    case 'h2':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(String(section.content || ''))]
      })]
    case 'p':
      return [new Paragraph({
        children: [new TextRun(String(section.content || ''))]
      })]
    case 'list': {
      const items = Array.isArray(section.items) ? section.items : []
      return items.map(item => new Paragraph({
        text: String(item),
        bullet: { level: 0 }
      }))
    }
    case 'code':
      return [new Paragraph({
        children: [new TextRun({
          text: String(section.code || ''),
          font: 'Courier New'
        })],
        shading: {
          type: ShadingType.CLEAR,
          fill: 'F4F4F4'
        }
      })]
    case 'table': {
      const rows = Array.isArray(section.rows) ? section.rows : []
      const tableRows = rows.map(row => new TableRow({
        children: row.map(cell => new TableCell({
          children: [new Paragraph({ children: [new TextRun(String(cell == null ? '' : cell))] })]
        }))
      }))
      return [new Table({ rows: tableRows })]
    }
    default:
      // 未知类型：忽略（不抛，避免拖垮整个文档）
      return []
  }
}

async function write(payload) {
  const title = (payload && payload.title) || 'untitled'
  const sections = (payload && Array.isArray(payload.sections)) ? payload.sections : []

  const children = []
  // 文档顶部用 title 作为 Heading 1（保证打开就是命名）
  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun(String(title))]
  }))

  for (const s of sections) {
    const rendered = renderSection(s)
    for (const node of rendered) children.push(node)
  }

  const doc = new Document({
    creator: 'concrete-mixdesign',
    title,
    sections: [{ properties: {}, children }]
  })

  return await Packer.toBuffer(doc)
}

module.exports = { write }