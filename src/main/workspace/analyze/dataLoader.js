// 数据加载器：从 xlsx/csv/wiki markdown 表格读取数据，统一输出二维数组+列名
//
// 三种数据源：
//   1. xlsx 文件 → 用 SheetJS（项目已有 xlsx 依赖）
//   2. csv 文件 → 用 papaparse（项目已有 papaparse 依赖）
//   3. wiki markdown 表格 → 解析 markdown 表格语法反解成二维数组
//
// 输出统一格式：
//   { columns: string[], rows: Array<Array<string|number|null>>, source: 'xlsx'|'csv'|'wiki' }
const fs = require('fs').promises
const path = require('path')
const { WorkspaceError } = require('../WorkspaceError')

/**
 * 从 xlsx 文件读取数据
 * @param {string} absPath - 绝对路径
 * @param {Object} [opts]
 * @param {string} [opts.sheet] - sheet 名（默认第一个）
 * @param {boolean} [opts.firstRowAsHeader=true] - 首行作为列名
 * @returns {Promise<{columns: string[], rows: Array[], source: 'xlsx'}>}
 */
async function loadXlsx(absPath, opts = {}) {
  const xlsx = require('xlsx')
  let workbook
  try {
    workbook = xlsx.readFile(absPath)
  } catch (err) {
    throw new WorkspaceError('PARSE_FAIL', `xlsx 解析失败: ${err.message}`, false, err)
  }

  const sheetNames = workbook.SheetNames || []
  if (sheetNames.length === 0) {
    return { columns: [], rows: [], source: 'xlsx' }
  }

  const sheetName = opts.sheet || sheetNames[0]
  const ws = workbook.Sheets[sheetName]
  if (!ws) {
    throw new WorkspaceError('PARSE_FAIL', `sheet 不存在: ${sheetName}（可用: ${sheetNames.join(', ')}）`, false)
  }

  // header:1 → 二维数组，defval:'' 保证空单元格有值
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' })
  return splitHeaderAndRows(rows, opts.firstRowAsHeader !== false)
}

/**
 * 从 csv 文件读取数据
 * @param {string} absPath
 * @param {Object} [opts]
 * @param {string} [opts.delimiter] - 分隔符，默认自动检测
 * @param {boolean} [opts.firstRowAsHeader=true]
 * @returns {Promise<{columns: string[], rows: Array[], source: 'csv'}>}
 */
async function loadCsv(absPath, opts = {}) {
  const Papa = require('papaparse')
  const text = await fs.readFile(absPath, 'utf-8')

  const result = Papa.parse(text, {
    skipEmptyLines: true,
    dynamicTyping: true, // 自动把数字转成 number
    delimiter: opts.delimiter, // undefined 时 papaparse 自动检测
  })

  if (result.errors && result.errors.length > 0) {
    // 只报第一个错误，避免日志爆炸
    const e = result.errors[0]
    throw new WorkspaceError('PARSE_FAIL', `CSV 解析错误（行 ${e.row}）: ${e.message}`, false)
  }

  return splitHeaderAndRows(result.data, opts.firstRowAsHeader !== false)
}

/**
 * 从 wiki markdown 表格读取数据
 * @param {string} markdown - markdown 全文
 * @param {Object} [opts]
 * @param {number} [opts.tableIndex=0] - 第几个表格（默认第一个）
 * @param {boolean} [opts.firstRowAsHeader=true]
 * @returns {{columns: string[], rows: Array[], source: 'wiki'}}
 */
function loadWikiTable(markdown, opts = {}) {
  const tables = extractMarkdownTables(markdown)
  if (tables.length === 0) {
    throw new WorkspaceError('PARSE_FAIL', 'markdown 中未找到表格', false)
  }

  const idx = opts.tableIndex || 0
  if (idx >= tables.length) {
    throw new WorkspaceError('PARSE_FAIL', `表格索引超出（共 ${tables.length} 个表，请求第 ${idx} 个）`, false)
  }

  return { ...splitHeaderAndRows(tables[idx], opts.firstRowAsHeader !== false), source: 'wiki' }
}

/**
 * 从 markdown 文本中提取所有表格（每个表格是二维数组）
 * 规则：连续的 | 分隔行 + |---|---| 分隔行
 */
function extractMarkdownTables(markdown) {
  const lines = markdown.split(/\r?\n/)
  const tables = []
  let current = []
  let inTable = false
  let sawSeparator = false

  for (const line of lines) {
    const trimmed = line.trim()
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|')
    const isSeparator = /^\|[\s:|-]+\|$/.test(trimmed) && trimmed.includes('-')

    if (isTableRow) {
      inTable = true
      if (isSeparator) {
        sawSeparator = true
      } else {
        current.push(parseTableRow(trimmed))
      }
    } else {
      if (inTable && sawSeparator && current.length > 0) {
        tables.push(current)
      }
      current = []
      inTable = false
      sawSeparator = false
    }
  }
  // 文件末尾的表格
  if (inTable && sawSeparator && current.length > 0) {
    tables.push(current)
  }
  return tables
}

function parseTableRow(line) {
  // 去掉首尾 |，按 | 分割，每个单元格 trim 并处理转义
  const inner = line.slice(1, -1)
  return inner.split('|').map(cell => {
    let c = cell.trim()
    // 反转义 markdown 表格转义
    c = c.replace(/\\\|/g, '|')
    // 尝试转数字
    if (c === '') return ''
    const n = Number(c)
    if (!isNaN(n) && c !== '') return n
    return c
  })
}

/**
 * 二维数组拆分成 列名 + 数据行
 * @param {Array[]} rows
 * @param {boolean} firstRowAsHeader
 */
function splitHeaderAndRows(rows, firstRowAsHeader) {
  if (!rows || rows.length === 0) {
    return { columns: [], rows: [], source: 'unknown' }
  }
  if (!firstRowAsHeader) {
    const cols = rows[0].map((_, i) => `col${i + 1}`)
    return { columns: cols, rows: rows.slice(0), source: 'unknown' }
  }
  const header = rows[0].map(h => String(h || '').trim())
  const data = rows.slice(1)
  // 补齐列名（空表头用 col1/col2 占位）
  const columns = header.map((h, i) => h || `col${i + 1}`)
  return { columns, rows: data, source: 'unknown' }
}

/**
 * 统一加载入口
 * @param {string} workspacePath - 工作区根目录绝对路径
 * @param {Object} source - 数据源描述
 * @param {'xlsx'|'csv'|'wiki'} source.type
 * @param {string} source.filePath - xlsx/csv 文件相对工作区的路径
 * @param {string} [source.markdown] - wiki 数据源直接传 markdown 全文
 * @param {string} [source.sheet]
 * @param {number} [source.tableIndex]
 * @param {boolean} [source.firstRowAsHeader=true]
 */
async function load(workspacePath, source) {
  if (!source || !source.type) {
    throw new WorkspaceError('PARAM_INVALID', 'source.type 必填（xlsx/csv/wiki）', false)
  }

  if (source.type === 'wiki') {
    if (!source.markdown) {
      throw new WorkspaceError('PARAM_INVALID', 'wiki 数据源必须传 source.markdown', false)
    }
    return loadWikiTable(source.markdown, source)
  }

  if (!source.filePath) {
    throw new WorkspaceError('PARAM_INVALID', `${source.type} 数据源必须传 source.filePath`, false)
  }

  // 安全（2026-08-22 审查）：绝对路径是设计能力（分析用户指定文件，扩展名白名单兜底），
  // 相对路径必须收口在工作区内，防 ".." 逃逸
  let absPath
  if (path.isAbsolute(source.filePath)) {
    absPath = source.filePath
  } else {
    try {
      const { resolveInside } = require('../../utils/pathGuard')
      absPath = resolveInside(workspacePath, source.filePath, '数据文件路径')
    } catch (e) {
      throw new WorkspaceError('PARAM_INVALID', e.message, false)
    }
  }

  const ext = path.extname(absPath).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') {
    const r = await loadXlsx(absPath, source)
    return { ...r, source: 'xlsx' }
  }
  if (ext === '.csv' || ext === '.tsv') {
    const r = await loadCsv(absPath, source)
    return { ...r, source: 'csv' }
  }
  throw new WorkspaceError('UNSUPPORTED_FORMAT', `不支持的文件格式: ${ext}（仅支持 xlsx/csv/tsv）`, false)
}

module.exports = {
  load,
  loadXlsx,
  loadCsv,
  loadWikiTable,
  extractMarkdownTables, // 导出便于测试
}
