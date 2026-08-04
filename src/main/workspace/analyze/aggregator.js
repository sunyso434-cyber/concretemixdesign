// 统计引擎：对二维数据做基础聚合
//
// 支持操作：
//   - aggregate: sum/avg/count/min/max/stddev 按整列聚合
//   - groupBy:   按某列分组后聚合
//
// 输入：dataLoader 输出的 { columns, rows }
// 输出：{ columns, rows } 仍是表格形式，方便 chartRenderer 直接用
//
// 数值处理：
//   - 空字符串/null/undefined → 跳过（不参与统计）
//   - 非数字字符串 → 跳过并记 warn
//   - 数字 → 正常参与统计

const { WorkspaceError } = require('../WorkspaceError')

/**
 * 列索引查找：列名 → 列索引
 */
function findColumnIndex(columns, name) {
  const idx = columns.indexOf(name)
  if (idx < 0) {
    throw new WorkspaceError('COLUMN_NOT_FOUND', `列不存在: ${name}（可用列: ${columns.join(', ')}）`, false)
  }
  return idx
}

/**
 * 把单元格值转成数字，转不了返回 null
 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).trim()
  if (s === '') return null
  // 去掉百分号
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1))
    return isNaN(n) ? null : n / 100
  }
  const n = Number(s)
  return isNaN(n) ? null : n
}

/**
 * 提取一列的数值数组（跳过非数字）
 * @returns {{values: number[], skipped: number}}
 */
function extractNumericColumn(rows, colIdx) {
  const values = []
  let skipped = 0
  for (const row of rows) {
    const n = toNumber(row[colIdx])
    if (n === null) {
      skipped++
    } else {
      values.push(n)
    }
  }
  return { values, skipped }
}

/**
 * 聚合操作
 * @param {{columns: string[], rows: Array[]}} data
 * @param {Object} opts
 * @param {string} opts.column - 要聚合的列名
 * @param {'sum'|'avg'|'count'|'min'|'max'|'stddev'} opts.operation
 * @returns {{columns: string[], rows: Array[], metadata: {operation, column, skipped, count}}}
 */
function aggregate(data, opts) {
  if (!data || !data.columns || !data.rows) {
    throw new WorkspaceError('PARAM_INVALID', 'data 必须包含 columns 和 rows', false)
  }
  if (!opts || !opts.column || !opts.operation) {
    throw new WorkspaceError('PARAM_INVALID', 'opts.column 和 opts.operation 必填', false)
  }

  const colIdx = findColumnIndex(data.columns, opts.column)

  // count 操作特殊：统计所有非空单元格（不限数字）
  if (opts.operation === 'count') {
    let count = 0
    for (const row of data.rows) {
      const v = row[colIdx]
      if (v !== null && v !== undefined && v !== '') count++
    }
    return {
      columns: ['operation', 'column', 'count'],
      rows: [[opts.operation, opts.column, count]],
      metadata: { operation: opts.operation, column: opts.column, count, skipped: 0 },
    }
  }

  const { values, skipped } = extractNumericColumn(data.rows, colIdx)
  if (values.length === 0) {
    throw new WorkspaceError('NO_NUMERIC_DATA', `列「${opts.column}」没有可统计的数值（全部为空或非数字）`, false)
  }

  let result
  switch (opts.operation) {
    case 'sum':
      result = values.reduce((a, b) => a + b, 0)
      break
    case 'avg':
      result = values.reduce((a, b) => a + b, 0) / values.length
      break
    case 'min':
      result = Math.min(...values)
      break
    case 'max':
      result = Math.max(...values)
      break
    case 'stddev':
      if (values.length < 2) {
        throw new WorkspaceError('NO_NUMERIC_DATA', 'stddev 至少需要 2 个数值', false)
      }
      {
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
        result = Math.sqrt(variance)
      }
      break
    default:
      throw new WorkspaceError('PARAM_INVALID', `不支持的 operation: ${opts.operation}（可用: sum/avg/count/min/max/stddev）`, false)
  }

  // 结果四舍五入保留 4 位小数
  const rounded = Math.round(result * 10000) / 10000

  return {
    columns: ['operation', 'column', 'value'],
    rows: [[opts.operation, opts.column, rounded]],
    metadata: {
      operation: opts.operation,
      column: opts.column,
      count: values.length,
      skipped,
    },
  }
}

/**
 * 分组聚合
 * @param {{columns: string[], rows: Array[]}} data
 * @param {Object} opts
 * @param {string} opts.groupBy - 分组列名
 * @param {string} opts.column - 聚合列名
 * @param {'sum'|'avg'|'count'|'min'|'max'} opts.operation
 * @returns {{columns: string[], rows: Array[], metadata: {operation, groupBy, column, groups}}}
 */
function groupBy(data, opts) {
  if (!data || !data.columns || !data.rows) {
    throw new WorkspaceError('PARAM_INVALID', 'data 必须包含 columns 和 rows', false)
  }
  if (!opts || !opts.groupBy || !opts.column || !opts.operation) {
    throw new WorkspaceError('PARAM_INVALID', 'opts.groupBy/column/operation 必填', false)
  }

  const groupIdx = findColumnIndex(data.columns, opts.groupBy)
  const valueIdx = findColumnIndex(data.columns, opts.column)

  // 分组：{ groupName: {values: number[], skipped: 0} }
  const groups = new Map()
  for (const row of data.rows) {
    const key = row[groupIdx]
    if (key === null || key === undefined || key === '') continue // 空分组值跳过

    const keyStr = String(key)
    if (!groups.has(keyStr)) {
      groups.set(keyStr, { values: [], skipped: 0 })
    }
    const g = groups.get(keyStr)
    const n = toNumber(row[valueIdx])
    if (n === null) {
      g.skipped++
    } else {
      g.values.push(n)
    }
  }

  if (groups.size === 0) {
    throw new WorkspaceError('NO_NUMERIC_DATA', `按「${opts.groupBy}」分组后没有可用数据`, false)
  }

  const opColName = `${opts.operation}(${opts.column})`
  const resultRows = []
  let totalSkipped = 0

  for (const [groupName, g] of groups) {
    let value
    if (opts.operation === 'count') {
      value = g.values.length
    } else if (g.values.length === 0) {
      continue // 该组没数据，跳过
    } else {
      switch (opts.operation) {
        case 'sum':
          value = g.values.reduce((a, b) => a + b, 0)
          break
        case 'avg':
          value = g.values.reduce((a, b) => a + b, 0) / g.values.length
          break
        case 'min':
          value = Math.min(...g.values)
          break
        case 'max':
          value = Math.max(...g.values)
          break
        default:
          throw new WorkspaceError('PARAM_INVALID', `groupBy 不支持 operation: ${opts.operation}`, false)
      }
      value = Math.round(value * 10000) / 10000
    }
    resultRows.push([groupName, value])
    totalSkipped += g.skipped
  }

  return {
    columns: [opts.groupBy, opColName],
    rows: resultRows,
    metadata: {
      operation: opts.operation,
      groupBy: opts.groupBy,
      column: opts.column,
      groups: groups.size,
      skipped: totalSkipped,
    },
  }
}

module.exports = {
  aggregate,
  groupBy,
  toNumber,
  extractNumericColumn,
  findColumnIndex,
}
