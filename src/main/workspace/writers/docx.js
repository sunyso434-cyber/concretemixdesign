// docx writer：把 payload 序列化为 .docx（Buffer），应用 style 到字体/字号/颜色/页面
// payload: { title, sections: [{ type: 'h1'|'h2'|'p'|'table'|'list'|'code', content|rows|items|code }] }
// style:   可选，来自 report-styles mergeStyle 的最终样式对象（null 时用 docx 默认）
//          { page: { paperSize, orientation, margins },
//            typography: { titleFont, bodyFont, titleSize:{H1,H2,H3}, bodySize, lineSpacing },
//            color: { primary, tableBorder } }
//
// 应用的 style 字段（YAGNI，只应用实际能用的）：
//   - page.paperSize → section page.size（仅 A4，其他 fallback A4）
//   - page.orientation → section page.size.orientation + 交换宽高
//   - page.margins（cm）→ section page.margin（twips）
//   - typography.titleFont → 标题/TITLE 的 TextRun.font
//   - typography.bodyFont → 正文/列表/表格的 TextRun.font
//   - typography.titleSize.{H1,H2,H3} → 标题 TextRun.size（pt→半磅）
//   - typography.bodySize → 正文 TextRun.size
//   - typography.lineSpacing → 所有 Paragraph spacing.line（倍数→240 倍）
//   - color.primary → 标题 TextRun.color（命名色映射 hex）
//   未应用：color.tableBorder（现有 Table 用 docx 默认边框，YAGNI 不扩展）
//
// 输出：Promise<Buffer>（Packer.toBuffer）
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ShadingType,
  PageOrientation
} = require('docx')

// 命名色 → docx hex（不带 #）。只映射公文样式实际用到的 4 色，不扩展
const NAMED_COLOR_TO_HEX = {
  black: '000000',
  blue: '1890FF',
  red: 'F5222D',
  gray: '8C8C8C'
}

function resolveColor(name) {
  if (!name) return undefined
  if (NAMED_COLOR_TO_HEX[name]) return NAMED_COLOR_TO_HEX[name]
  // 已经是 6 位 hex 就直接用
  if (/^[0-9A-Fa-f]{6}$/.test(name)) return name
  return undefined
}

// 纸张尺寸（twips，portrait 方向）。YAGNI：只支持 A4
const PAPER_SIZE_TWIPS = {
  A4: { width: 11906, height: 16838 }
}

// 1cm ≈ 567 twips（1440/2.54 四舍五入）
const CM_TO_TWIPS = 567

function ptToHalfPt(pt) {
  return pt * 2
}

// lineSpacing 倍数 → docx line 值（240 = 单倍行距）
function lineSpacingToLine(multiple) {
  return Math.round(multiple * 240)
}

/**
 * 构造 section properties.page（size + margin）
 */
function buildPageProps(style) {
  const page = (style && style.page) || {}
  const sizeDef = PAPER_SIZE_TWIPS[page.paperSize] || PAPER_SIZE_TWIPS.A4
  let size
  if (page.orientation === 'landscape') {
    // landscape 时交换宽高
    size = { width: sizeDef.height, height: sizeDef.width, orientation: PageOrientation.LANDSCAPE }
  } else {
    size = { width: sizeDef.width, height: sizeDef.height, orientation: PageOrientation.PORTRAIT }
  }
  const pageProps = { size }
  if (page.margins && typeof page.margins === 'object') {
    const m = page.margins
    const margin = {}
    if (m.top != null) margin.top = Math.round(m.top * CM_TO_TWIPS)
    if (m.bottom != null) margin.bottom = Math.round(m.bottom * CM_TO_TWIPS)
    if (m.left != null) margin.left = Math.round(m.left * CM_TO_TWIPS)
    if (m.right != null) margin.right = Math.round(m.right * CM_TO_TWIPS)
    if (Object.keys(margin).length) pageProps.margin = margin
  }
  return pageProps
}

/**
 * 构造 TextRun 的属性（font/size/color），按节点种类决定用 titleFont 还是 bodyFont
 * kind: 'title' | 'h1' | 'h2' | 'h3' | 'body'
 */
function buildRunProps(style, kind) {
  const typo = (style && style.typography) || {}
  const color = (style && style.color) || {}
  const props = {}
  const isTitle = kind === 'title' || kind === 'h1' || kind === 'h2' || kind === 'h3'
  if (isTitle) {
    if (typo.titleFont) props.font = typo.titleFont
    const sizeMap = typo.titleSize || {}
    // TITLE 无独立字号字段，YAGNI 复用 H1 字号
    const sizeKey = kind === 'title' ? 'H1' : kind.toUpperCase()
    const sizePt = sizeMap[sizeKey]
    if (sizePt != null) props.size = ptToHalfPt(sizePt)
    if (color.primary) {
      const hex = resolveColor(color.primary)
      if (hex) props.color = hex
    }
  } else {
    if (typo.bodyFont) props.font = typo.bodyFont
    if (typo.bodySize != null) props.size = ptToHalfPt(typo.bodySize)
  }
  return props
}

/**
 * 构造 Paragraph 的 spacing（行距）。无 lineSpacing 返回 undefined（docx 库会忽略）
 */
function buildSpacing(style) {
  const ls = style && style.typography && style.typography.lineSpacing
  if (ls == null) return undefined
  return { line: lineSpacingToLine(ls), lineRule: 'auto' }
}

/**
 * 把单个 section 转成 docx 节点数组（一个 section 可能产出多个 children，比如 list）
 */
function renderSection(section, style) {
  if (!section || typeof section !== 'object') return []
  const spacing = buildSpacing(style)
  switch (section.type) {
    case 'h1':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing,
        children: [new TextRun({ text: String(section.content || ''), ...buildRunProps(style, 'h1') })]
      })]
    case 'h2':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing,
        children: [new TextRun({ text: String(section.content || ''), ...buildRunProps(style, 'h2') })]
      })]
    case 'p':
      return [new Paragraph({
        spacing,
        children: [new TextRun({ text: String(section.content || ''), ...buildRunProps(style, 'body') })]
      })]
    case 'list': {
      const items = Array.isArray(section.items) ? section.items : []
      return items.map(item => new Paragraph({
        bullet: { level: 0 },
        spacing,
        children: [new TextRun({ text: String(item), ...buildRunProps(style, 'body') })]
      }))
    }
    case 'code':
      // code 块保留等宽字体（惯例，不应用 bodyFont），但应用行距
      return [new Paragraph({
        spacing,
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
          children: [new Paragraph({
            spacing,
            children: [new TextRun({ text: String(cell == null ? '' : cell), ...buildRunProps(style, 'body') })]
          })]
        }))
      }))
      // color.tableBorder 未应用（YAGNI，Table 用 docx 默认边框）
      return [new Table({ rows: tableRows })]
    }
    default:
      // 未知类型：忽略（不抛，避免拖垮整个文档）
      return []
  }
}

async function write(payload, style = null) {
  const title = (payload && payload.title) || 'untitled'
  const sections = (payload && Array.isArray(payload.sections)) ? payload.sections : []

  const spacing = buildSpacing(style)
  const children = []
  // 文档顶部用 title 作为 TITLE（保证打开就是命名）
  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    spacing,
    children: [new TextRun({ text: String(title), ...buildRunProps(style, 'title') })]
  }))

  for (const s of sections) {
    const rendered = renderSection(s, style)
    for (const node of rendered) children.push(node)
  }

  const doc = new Document({
    creator: 'concrete-mixdesign',
    title,
    sections: [{ properties: { page: buildPageProps(style) }, children }]
  })

  return await Packer.toBuffer(doc)
}

module.exports = { write }
