// xlsx reader：读取 .xlsx 文件
// - 用 xlsx (SheetJS v0.18.5) 读取整个 workbook
// - 每个 sheet 渲染为 markdown 表格（header + separator + data rows）
// - 所有 sheet 用 `## Sheet: <name>` heading 分隔
//
// 所有失败抛 WorkspaceError（带 code + retryable）：
// - 文件 > 200MB → SIZE_EXCEEDED（retryable=false）
// - 损坏 / 解析失败（xlsx 库抛错） → PARSE_FAIL（retryable=false）
// - 其它（fs 等） → READ_FAIL（retryable=true）
const fs = require('fs').promises
const xlsx = require('xlsx')
const { WorkspaceError } = require('../WorkspaceError')

const MAX_SIZE = 200 * 1024 * 1024 // 200 MB

/**
 * 将 2D 数组（rows）渲染为 markdown 表格字符串。
 * - 第一行作为表头
 * - 第二行作为分隔行（`|---|---|`）
 * - 剩余行作为数据行
 * - 空单元格用空字符串
 * - 单元格内的 `|` 转义为 `\\|`，换行替换为空格，避免破坏表格语法
 */
function renderSheetAsMarkdown(rows) {
  if (!rows || rows.length === 0) {
    return '_(空 sheet)_'
  }

  // 规范化：所有 row 等长，缺失补空串
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const normalized = rows.map(row => {
    const padded = []
    for (let i = 0; i < width; i++) {
      const cell = row[i]
      if (cell === null || cell === undefined) {
        padded.push('')
      } else if (cell instanceof Date) {
        padded.push(cell.toISOString())
      } else {
        // 转义管道符 + 换行（保护 markdown 表格结构）
        padded.push(String(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '))
      }
    }
    return padded
  })

  const headerRow = normalized[0]
  const dataRows = normalized.slice(1)

  const headerLine = '| ' + headerRow.join(' | ') + ' |'
  const separatorLine = '|' + headerRow.map(() => '------').join('|') + '|'
  const dataLines = dataRows.map(row => '| ' + row.join(' | ') + ' |')

  return [headerLine, separatorLine, ...dataLines].join('\n')
}

async function read(filePath, options = {}) {
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_SIZE) {
      throw new WorkspaceError('SIZE_EXCEEDED', `${filePath} > 200MB`, false)
    }

    let workbook
    try {
      // xlsx.readFile = Node-only 文件系统 API（同步读 + 解析）
      // 不要用 xlsx.read —— 那是浏览器 File API
      workbook = xlsx.readFile(filePath)
    } catch (err) {
      // 损坏 / 加密 / 非 xlsx / SheetJS 内部错误 → PARSE_FAIL
      throw new WorkspaceError('PARSE_FAIL', `xlsx 解析失败: ${err.message}`, false, err)
    }

    const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : []

    if (sheetNames.length === 0) {
      // 没有任何 sheet：视为内容为空，但仍返回结构
      return {
        content: '_(xlsx 文件不包含任何 sheet)_',
        metadata: {
          sheetNames: [],
          sheetCount: 0,
          encoding: 'utf-8'
        }
      }
    }

    const sections = []
    for (const name of sheetNames) {
      const ws = workbook.Sheets[name]
      // header: 1 → 2D 数组（不依赖首行内容推断 key），方便空行/不规则数据
      const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const md = renderSheetAsMarkdown(rows)
      sections.push(`## Sheet: ${name}\n\n${md}`)
    }

    return {
      content: sections.join('\n\n'),
      metadata: {
        sheetNames,
        sheetCount: sheetNames.length,
        encoding: 'utf-8'
      }
    }
  } catch (err) {
    if (err instanceof WorkspaceError) throw err
    throw new WorkspaceError('READ_FAIL', `读取 ${filePath} 失败: ${err.message}`, true, err)
  }
}

module.exports = { read }