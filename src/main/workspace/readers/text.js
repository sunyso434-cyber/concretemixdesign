// text reader：读取 .txt 和 .csv 文件
// - .txt：直接 fs.readFile 返回原文（UTF-8）
// - .csv：papaparse 解析为 2D 数组，再渲染为 markdown 表格
//
// 所有失败抛 WorkspaceError（带 code + retryable）。
// size 限制：200 MB（> 200MB 触发 SIZE_EXCEEDED，retryable=false）
const fs = require('fs').promises
const path = require('path')
const Papa = require('papaparse')
const { WorkspaceError } = require('../WorkspaceError')

const MAX_SIZE = 200 * 1024 * 1024 // 200 MB

/**
 * 把 papaparse 的 2D 数组渲染为 markdown 表格
 * 第一行 = header，剩余 = 数据行
 */
function renderCsvAsMarkdown(rows) {
  if (!rows || rows.length === 0) return ''
  const header = rows[0]
  const body = rows.slice(1)
  const colCount = header.length

  const escape = (cell) => String(cell == null ? '' : cell)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')

  const headerLine = `| ${header.map(escape).join(' | ')} |`
  const sepLine = `| ${header.map(() => '---').join(' | ')} |`
  const bodyLines = body.map(row => {
    // 短行用空字符串补齐，确保对齐 colCount
    const padded = row.length < colCount
      ? [...row, ...Array(colCount - row.length).fill('')]
      : row
    return `| ${padded.map(escape).join(' | ')} |`
  })

  return [headerLine, sepLine, ...bodyLines].join('\n')
}

async function read(filePath, options = {}) {
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_SIZE) {
      throw new WorkspaceError('SIZE_EXCEEDED', `${filePath} > 200MB`, false)
    }

    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.csv') {
      const csvText = await fs.readFile(filePath, 'utf-8')
      const parsed = Papa.parse(csvText, { skipEmptyLines: true })
      const rows = parsed.data
      if (!rows || rows.length === 0) {
        throw new WorkspaceError('PARSE_FAIL', `CSV 内容为空: ${filePath}`, false)
      }
      const rowCount = rows.length
      const columnCount = rows[0] ? rows[0].length : 0
      return {
        content: renderCsvAsMarkdown(rows),
        metadata: { encoding: 'utf-8', rowCount, columnCount }
      }
    }

    if (ext === '.txt') {
      const content = await fs.readFile(filePath, 'utf-8')
      return {
        content,
        metadata: { encoding: 'utf-8' }
      }
    }

    throw new WorkspaceError(
      'READ_FAIL',
      `text reader 不支持扩展名 ${ext}: ${filePath}`,
      false
    )
  } catch (err) {
    if (err instanceof WorkspaceError) throw err
    throw new WorkspaceError('READ_FAIL', `读取 ${filePath} 失败: ${err.message}`, true, err)
  }
}

module.exports = { read }