// markdown writer：把 payload 序列化为 .md（Buffer，带 gray-matter frontmatter）
// payload: { title, metadata?: object, sections: [{ type, ... }] }
// 输出：Promise<Buffer>
//
// - frontmatter 用 gray-matter.stringify 生成（含 title + metadata 字段）
// - h1/h2/p/list/table/code 各对应 markdown 语法
const matter = require('gray-matter')

function escapeCell(text) {
  if (text === null || text === undefined) return ''
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function renderTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  // 等长化
  const normalized = rows.map(row => {
    const out = []
    for (let i = 0; i < width; i++) out.push(escapeCell(row[i]))
    return out
  })
  const header = normalized[0]
  const sep = header.map(() => '------')
  const dataRows = normalized.slice(1)
  const lines = [
    '| ' + header.join(' | ') + ' |',
    '|' + sep.join('|') + '|',
    ...dataRows.map(r => '| ' + r.join(' | ') + ' |')
  ]
  return lines.join('\n')
}

function renderSection(section) {
  if (!section || typeof section !== 'object') return ''
  switch (section.type) {
    case 'h1':
      return `# ${section.content || ''}`
    case 'h2':
      return `## ${section.content || ''}`
    case 'p':
      return String(section.content || '')
    case 'list': {
      const items = Array.isArray(section.items) ? section.items : []
      return items.map(i => `- ${i}`).join('\n')
    }
    case 'code': {
      const lang = section.language || ''
      const code = String(section.code || '')
      return '```' + lang + '\n' + code + '\n```'
    }
    case 'table':
      return renderTable(section.rows || [])
    default:
      return ''
  }
}

async function write(payload) {
  const title = (payload && payload.title) || 'untitled'
  const metadata = (payload && payload.metadata && typeof payload.metadata === 'object') ? payload.metadata : {}
  const sections = (payload && Array.isArray(payload.sections)) ? payload.sections : []

  // body：每个 section 一个段落，段落之间空行分隔
  const bodyParts = sections.map(renderSection).filter(s => s && s.length > 0)
  const body = bodyParts.join('\n\n') + (bodyParts.length > 0 ? '\n' : '')

  // frontmatter：title 始终写入；metadata 字段并入
  const frontmatter = { title, ...metadata }

  const text = matter.stringify(body, frontmatter)
  return Buffer.from(text, 'utf-8')
}

module.exports = { write }