/**
 * 一键把 docs/AI应用方案与心得体会_2026-07-15.md 转成 docx
 * - 正文字体：宋体
 * - 正文字号：小四（12pt）
 * - 标题/代码块/表格沿用同字体（标题加粗、放大）
 *
 * 用法：node scripts/md-to-docx.js
 */
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, convertInchesToTwip,
} = require('docx')

const MD_PATH = path.join(__dirname, '..', 'docs', 'AI应用方案与心得体会_2026-07-15.md')
const OUT_PATH = path.join(__dirname, '..', 'docs', 'AI应用方案与心得体会_2026-07-15.docx')

// ============== 样式常量 ==============
const FONT_CN = '宋体'           // 中文宋体
const FONT_EN = 'Times New Roman' // 英文/数字
const SIZE_BODY = 24              // 小四 = 12pt，docx 单位是半点（24 = 12pt）
const SIZE_H1 = 36                // 小一 18pt / 二号 22pt，选 18pt
const SIZE_H2 = 32                // 小三 15pt
const SIZE_H3 = 28                // 四号 14pt
const SIZE_H4 = 24                // 小四 12pt（同正文）
const SIZE_CODE = 22              // 小四略小，11pt
const PAGE_WIDTH = 11906          // A4 纸宽度（DXA）
const PAGE_HEIGHT = 16838         // A4 纸高度（DXA）
const CONTENT_WIDTH = 9026        // A4 左右各 1 英寸页边距后的正文宽度
const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' }
const tableBorders = {
  top: tableBorder,
  bottom: tableBorder,
  left: tableBorder,
  right: tableBorder,
  insideHorizontal: tableBorder,
  insideVertical: tableBorder,
}

// ============== 工具函数 ==============
const runCN = (text, opts = {}) => new TextRun({
  text,
  font: { ascii: FONT_EN, eastAsia: FONT_CN, hAnsi: FONT_EN },
  size: opts.size ?? SIZE_BODY,
  bold: opts.bold ?? false,
  italics: opts.italics ?? false,
  color: opts.color,
})

// 段落（含可选对齐/缩进/样式）
function para(runs, opts = {}) {
  return new Paragraph({
    alignment: opts.alignment ?? AlignmentType.LEFT,
    spacing: { before: opts.before ?? 60, after: opts.after ?? 60, line: 360, lineRule: 'auto' },
    indent: opts.indent,
    children: runs,
  })
}

function textPara(text, opts = {}) {
  return para([runCN(text, opts)], opts)
}

// ============== Markdown 解析 ==============
function parseMd(md) {
  const lines = md.split(/\r?\n/)
  const blocks = [] // { type, ... }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (line.trim() === '') { i++; continue }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() })
      i++; continue
    }

    // 代码块（围栏）
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') })
      continue
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s\-:|]+\|?\s*$/.test(lines[i + 1])) {
      const tableLines = []
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'table', lines: tableLines })
      continue
    }

    // 引用块（> xxx）
    if (line.startsWith('>')) {
      const quoteLines = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') })
      continue
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // 普通段落（直到遇到空行或块级元素）
    const paraLines = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+\.\s|\|)/.test(lines[i])) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') })
  }
  return blocks
}

// ============== 行内格式解析（**bold** *italic* `code`）==============
function parseInline(text) {
  const runs = []
  let buf = ''
  let i = 0
  const flush = (extra = {}) => {
    if (buf) {
      runs.push(runCN(buf, { bold: extra.bold, italics: extra.italics }))
      buf = ''
    }
  }
  while (i < text.length) {
    // **bold**
    if (text[i] === '*' && text[i + 1] === '*') {
      flush()
      const end = text.indexOf('**', i + 2)
      if (end === -1) { buf += text[i]; i++; continue }
      const inner = text.slice(i + 2, end)
      runs.push(runCN(inner, { bold: true }))
      i = end + 2
      continue
    }
    // *italic*
    if (text[i] === '*' && text[i + 1] !== '*') {
      flush()
      const end = text.indexOf('*', i + 1)
      if (end === -1 || text[end + 1] === '*') { buf += text[i]; i++; continue }
      const inner = text.slice(i + 1, end)
      runs.push(runCN(inner, { italics: true }))
      i = end + 1
      continue
    }
    // `code`
    if (text[i] === '`') {
      flush()
      const end = text.indexOf('`', i + 1)
      if (end === -1) { buf += text[i]; i++; continue }
      const inner = text.slice(i + 1, end)
      runs.push(new TextRun({
        text: inner,
        font: { ascii: 'Consolas', eastAsia: FONT_CN, hAnsi: 'Consolas' },
        size: SIZE_CODE,
        shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
      }))
      i = end + 1
      continue
    }
    buf += text[i]
    i++
  }
  flush()
  return runs
}

// ============== Block 渲染 ==============
function renderBlocks(blocks) {
  const children = []
  const numberingConfigs = []
  let listIndex = 0
  for (const b of blocks) {
    if (b.type === 'heading') {
      const size = [SIZE_H1, SIZE_H2, SIZE_H3, SIZE_H4, SIZE_BODY, SIZE_BODY][b.level - 1] ?? SIZE_BODY
      children.push(new Paragraph({
        heading: HeadingLevel[`HEADING_${b.level}`],
        spacing: { before: 240, after: 120, line: 360, lineRule: 'auto' },
        children: [runCN(b.text, { size, bold: true })],
      }))
    }
    else if (b.type === 'paragraph') {
      children.push(para(parseInline(b.text), { before: 60, after: 60 }))
    }
    else if (b.type === 'quote') {
      const lines = b.text.split('\n')
      for (const l of lines) {
        children.push(para(parseInline(l), {
          indent: { left: convertInchesToTwip(0.3) },
          before: 40, after: 40,
        }))
      }
    }
    else if (b.type === 'code') {
      const codeLines = b.text.split('\n')
      for (const l of codeLines) {
        children.push(new Paragraph({
          spacing: { before: 0, after: 0, line: 280, lineRule: 'auto' },
          shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
          children: [new TextRun({
            text: l || ' ',
            font: { ascii: 'Consolas', eastAsia: FONT_CN, hAnsi: 'Consolas' },
            size: SIZE_CODE,
          })],
        }))
      }
    }
    else if (b.type === 'ul') {
      const reference = `bullet-list-${listIndex++}`
      numberingConfigs.push({
        reference,
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      })
      for (const item of b.items) {
        children.push(new Paragraph({
          numbering: { reference, level: 0 },
          spacing: { before: 30, after: 30, line: 360, lineRule: 'auto' },
          children: parseInline(item),
        }))
      }
    }
    else if (b.type === 'ol') {
      const reference = `number-list-${listIndex++}`
      numberingConfigs.push({
        reference,
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      })
      for (const item of b.items) {
        children.push(new Paragraph({
          numbering: { reference, level: 0 },
          spacing: { before: 30, after: 30, line: 360, lineRule: 'auto' },
          children: parseInline(item),
        }))
      }
    }
    else if (b.type === 'table') {
      // 解析表格：第 0 行是表头，第 1 行是分隔符（| --- | --- |），其余是数据
      const rows = b.lines.map(l => l.split('|').map(c => c.trim()).filter((c, idx, arr) => {
        // 去掉首尾空元素（如果行首行尾有 |）
        return !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === '')
      }))
      // 跳过第 1 行（分隔符）
      const dataRows = [rows[0], ...rows.slice(2)]
      const colCount = dataRows[0].length
      const baseWidth = Math.floor(CONTENT_WIDTH / colCount)
      const columnWidths = Array.from(
        { length: colCount },
        (_, idx) => baseWidth + (idx === colCount - 1 ? CONTENT_WIDTH - baseWidth * colCount : 0)
      )

      const table = new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths,
        rows: dataRows.map((row, rIdx) => new TableRow({
          tableHeader: rIdx === 0,
          children: row.map((cell, colIdx) => new TableCell({
            borders: tableBorders,
            width: { size: columnWidths[colIdx], type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: rIdx === 0 ? { type: ShadingType.CLEAR, fill: 'D9E2F3', color: 'auto' } : undefined,
            children: [para(parseInline(cell || ' '), {
              before: 20, after: 20, line: 280, lineRule: 'auto',
            })],
          })),
        })),
      })
      children.push(table)
      children.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [runCN('')] }))
    }
  }
  return { children, numberingConfigs }
}

// ============== 主流程 ==============
function main() {
  const md = fs.readFileSync(MD_PATH, 'utf-8')
  const blocks = parseMd(md)
  const { children: docChildren, numberingConfigs } = renderBlocks(blocks)

  const doc = new Document({
    creator: '砼智 Concrete Agent',
    title: 'AI 在混凝土配合比设计中的应用方案与心得体会',
    numbering: { config: numberingConfigs },
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: FONT_EN, eastAsia: FONT_CN, hAnsi: FONT_EN },
            size: SIZE_BODY,
          },
          paragraph: {
            spacing: { line: 360, lineRule: 'auto' },
          },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
          },
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
          },
        },
      },
      children: docChildren,
    }],
  })

  Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(OUT_PATH, buf)
    console.log(`✓ 已生成: ${OUT_PATH}`)
    console.log(`  文件大小: ${(buf.length / 1024).toFixed(1)} KB`)
  }).catch(err => {
    console.error('生成失败:', err)
    process.exit(1)
  })
}

main()
