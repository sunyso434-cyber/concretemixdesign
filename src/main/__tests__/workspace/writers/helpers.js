// writers 测试辅助工具
// - validateDocxStructure(buf) → 用 zip 头校验（docx 本质是 zip；不解压全部内容）
// - validateXlsxStructure(buf) → 同上（xlsx 也是 zip）
// - detectMarkdownFrontmatter(text) → 校验 frontmatter 格式
const fs = require('fs')
const zlib = require('zlib')

// docx/xlsx 都是 zip（PK\x03\x04 起头）。这里做轻量校验即可。
function hasZipHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

function validateDocxStructure(buf) {
  if (!hasZipHeader(buf)) return false
  // docx 必有 [Content_Types].xml（zip 内）。我们做轻量 EOCD 扫描：
  // 找 "PK\x05\x06" (EOCD) + 之后的中央目录记录中是否含 "Content_Types"。
  // 为了简单，扫描整个 buffer 的字节序列里是否包含 "Content_Types"。
  return buf.includes(Buffer.from('Content_Types'))
}

function validateXlsxStructure(buf) {
  if (!hasZipHeader(buf)) return false
  // xlsx 必有 "xl/" 目录 + "workbook.xml"。轻量校验：含 "workbook" 字串。
  return buf.includes(Buffer.from('workbook'))
}

function detectMarkdownFrontmatter(text) {
  if (typeof text !== 'string') return { hasFrontmatter: false, frontmatter: {}, body: '' }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { hasFrontmatter: false, frontmatter: {}, body: text }
  // 极简 YAML 解析：仅 key: value（值是 string / number / 数组）
  const lines = m[1].split(/\r?\n/)
  const frontmatter = {}
  let currentArrayKey = null
  for (const line of lines) {
    if (!line.trim()) continue
    const arrayItem = line.match(/^\s+-\s+(.+)$/)
    if (arrayItem && currentArrayKey) {
      frontmatter[currentArrayKey].push(arrayItem[1].trim().replace(/^["']|["']$/g, ''))
      continue
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) {
      const key = kv[1]
      const value = kv[2].trim()
      if (value === '') {
        frontmatter[key] = []
        currentArrayKey = key
      } else {
        currentArrayKey = null
        // 去引号
        const cleaned = value.replace(/^["']|["']$/g, '')
        // 试 number
        const num = Number(cleaned)
        frontmatter[key] = !Number.isNaN(num) && cleaned !== '' ? num : cleaned
      }
    }
  }
  return { hasFrontmatter: true, frontmatter, body: text.slice(m[0].length) }
}

module.exports = {
  validateDocxStructure,
  validateXlsxStructure,
  detectMarkdownFrontmatter,
  hasZipHeader
}