/**
 * XlsxReportService - 一键 xlsx 报表生成服务（exceljs 驱动）
 *
 * 供 agent 技能 generate_xlsx_report 调用；纯生成逻辑，不依赖 Electron，
 * 可在 jest 中直接测试。与 OfficeCLI 的协作边界见 docs/2026-08-24-xlsx-migration-plan.md：
 *   - 本服务负责"从零造表"（结构化数据 → 专业样式工作簿）；
 *   - 编辑已有文件 / 图表 / 条件格式等高级元素由 OfficeCLI 接力（产物为标准 xlsx，互通）。
 *
 * spec 结构：
 * {
 *   theme?: 'professional' | 'gray' | 'warm',
 *   sheets: [{
 *     name: string,                 // Sheet 名（≤31 字符，不含 : \ / ? * [ ]）
 *     title?: string,               // 首行大标题（自动合并整行）
 *     columns: [string | {          // 列定义；字符串简写=表头即键名
 *       header, key?, width?, numFmt?, align?: 'left'|'center'|'right', bold?
 *     }],
 *     rows: [object | array],       // 对象按 key 取值，数组按列序取值
 *     zebra?: boolean,              // 斑马纹，默认 true
 *     freeze?: false | true,        // 冻结表头，默认 true（有标题行时连标题一起冻结）
 *     autofilter?: boolean,         // 表头筛选，默认 false
 *     tabColor?: 'RRGGBB',          // 页签颜色
 *     totalRow?: { label?: string, sumKeys?: string[] },   // 总计行（对指定列求和）
 *     cells?: {                     // 单元格级微调（地址如 'B3'）
 *       B3: { bold?, italic?, color?, fill?, numFmt?, align?, size? }
 *     },
 *   }]
 * }
 */

const ExcelJS = require('exceljs')

// 配色主题（ARGB 前缀 FF = 不透明）
const THEMES = {
  professional: {
    headerFill: 'FF1F4E79', headerColor: 'FFFFFFFF',
    titleColor: 'FF1F4E79', zebraFill: 'FFF2F7FC',
    totalFill: 'FFE8F1FA', borderColor: 'FFB7C6D9',
  },
  gray: {
    headerFill: 'FF595959', headerColor: 'FFFFFFFF',
    titleColor: 'FF404040', zebraFill: 'FFF5F5F5',
    totalFill: 'FFEDEDED', borderColor: 'FFC9C9C9',
  },
  warm: {
    headerFill: 'FFC55A11', headerColor: 'FFFFFFFF',
    titleColor: 'FF843C0C', zebraFill: 'FFFDF3EC',
    totalFill: 'FFFCE4D6', borderColor: 'FFE0B9A0',
  },
}

const DEFAULT_THEME = 'professional'
const SHEET_NAME_MAX = 31
const SHEET_NAME_BAD_CHARS = /[:\\/?*[\]]/

/** 颜色规范化：'RGB'/'#RGB'/'ARRGB' → 'FFRRGGBB'；非法抛错 */
function normalizeColor(color) {
  if (typeof color !== 'string') throw new Error(`颜色必须是字符串，收到: ${typeof color}`)
  let c = color.trim().replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{6}$/.test(c)) return `FF${c}`
  if (/^[0-9A-F]{8}$/.test(c)) return c
  throw new Error(`颜色格式不合法: "${color}"（应为 RRGGBB 或 AARRGGBB 十六进制）`)
}

/** 校验并规范化列定义 */
function normalizeColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('每个 sheet 必须提供非空的 columns 数组')
  }
  const seen = new Set()
  return columns.map((col, i) => {
    const def = typeof col === 'string' ? { header: col } : { ...col }
    if (!def.header || typeof def.header !== 'string') {
      throw new Error(`第 ${i + 1} 列缺少 header`)
    }
    const key = def.key !== undefined ? String(def.key) : def.header
    if (seen.has(key)) throw new Error(`列键重复: "${key}"`)
    seen.add(key)
    if (def.align && !['left', 'center', 'right'].includes(def.align)) {
      throw new Error(`列 "${def.header}" 的 align 只支持 left/center/right`)
    }
    return { ...def, _key: key }
  })
}

/** 从行数据取某列的值（对象按键、数组按列序、缺省为 null） */
function pickCellValue(row, col, colIndex) {
  if (row === null || row === undefined) return null
  if (Array.isArray(row)) return row[colIndex] !== undefined ? row[colIndex] : null
  if (typeof row === 'object') return row[col._key] !== undefined ? row[col._key] : null
  throw new Error('rows 的每一项必须是对象或数组')
}

/** 校验 spec 基本结构，返回带主题的规范化上下文 */
function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('spec 必须是对象')
  if (!Array.isArray(spec.sheets) || spec.sheets.length === 0) {
    throw new Error('spec.sheets 必须是非空数组')
  }
  const names = spec.sheets.map(s => s && s.name).filter(Boolean)
  if (names.length !== spec.sheets.length) throw new Error('每个 sheet 必须有 name')
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) throw new Error(`Sheet 名重复: "${dup}"`)
  for (const name of names) {
    if (typeof name !== 'string' || name.length > SHEET_NAME_MAX) {
      throw new Error(`Sheet 名 "${name}" 超过 ${SHEET_NAME_MAX} 字符上限`)
    }
    if (SHEET_NAME_BAD_CHARS.test(name)) {
      throw new Error(`Sheet 名 "${name}" 含非法字符 : \\ / ? * [ ]`)
    }
  }
  for (const s of spec.sheets) {
    if (!Array.isArray(s.columns) || s.columns.length === 0) {
      throw new Error(`Sheet "${s.name}" 必须提供非空的 columns 数组`)
    }
    if (s.rows !== undefined && !Array.isArray(s.rows)) {
      throw new Error(`Sheet "${s.name}" 的 rows 必须是数组`)
    }
    if (Array.isArray(s.rows)) {
      for (const r of s.rows) {
        if (r === null || typeof r !== 'object') {
          throw new Error(`Sheet "${s.name}" 的 rows 每一项必须是对象或数组`)
        }
      }
    }
  }
  const themeKey = spec.theme || DEFAULT_THEME
  const theme = THEMES[themeKey]
  if (!theme) throw new Error(`未知主题 "${spec.theme}"，可选: ${Object.keys(THEMES).join(', ')}`)
  return { theme, themeKey }
}

/** 生成单元格样式覆盖（cells 字段） */
function applyCellOverrides(ws, cells) {
  if (!cells || typeof cells !== 'object') return
  for (const [addr, patch] of Object.entries(cells)) {
    if (!/^[A-Z]{1,3}\d{1,7}$/i.test(addr)) {
      throw new Error(`cells 地址不合法: "${addr}"（应为 A1 形式）`)
    }
    const cell = ws.getCell(addr)
    if (patch.bold !== undefined) cell.font = { ...cell.font, bold: !!patch.bold }
    if (patch.italic !== undefined) cell.font = { ...cell.font, italic: !!patch.italic }
    if (patch.size !== undefined) cell.font = { ...cell.font, size: patch.size }
    if (patch.color !== undefined) cell.font = { ...cell.font, color: { argb: normalizeColor(patch.color) } }
    if (patch.fill !== undefined) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: normalizeColor(patch.fill) } }
    }
    if (patch.numFmt !== undefined) cell.numFmt = patch.numFmt
    if (patch.align !== undefined) cell.alignment = { ...cell.alignment, horizontal: patch.align }
  }
}

/** 生成单个 worksheet，返回该 sheet 行数统计 */
function buildSheet(wb, sheetSpec, theme) {
  const columns = normalizeColumns(sheetSpec.columns)
  const rows = Array.isArray(sheetSpec.rows) ? sheetSpec.rows : []
  const ws = wb.addWorksheet(sheetSpec.name)

  const hasTitle = typeof sheetSpec.title === 'string' && sheetSpec.title.length > 0
  const headerRowIndex = hasTitle ? 2 : 1

  // ---- 标题行 ----
  if (hasTitle) {
    ws.mergeCells(1, 1, 1, columns.length)
    const t = ws.getCell(1, 1)
    t.value = sheetSpec.title
    t.font = { bold: true, size: 14, color: { argb: theme.titleColor } }
    t.alignment = { horizontal: 'left', vertical: 'middle' }
    ws.getRow(1).height = 26
  }

  // ---- 表头行 ----
  const headerRow = ws.getRow(headerRowIndex)
  columns.forEach((col, i) => {
    const c = headerRow.getCell(i + 1)
    c.value = col.header
    c.font = { bold: true, color: { argb: theme.headerColor } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.headerFill } }
    c.border = {
      top: { style: 'thin', color: { argb: theme.borderColor } },
      bottom: { style: 'thin', color: { argb: theme.borderColor } },
      left: { style: 'thin', color: { argb: theme.borderColor } },
      right: { style: 'thin', color: { argb: theme.borderColor } },
    }
    c.alignment = { horizontal: col.align || 'center', vertical: 'middle', wrapText: true }
    if (col.width !== undefined) ws.getColumn(i + 1).width = col.width
  })
  headerRow.height = 20

  // ---- 数据行 ----
  rows.forEach((row, rIdx) => {
    const r = ws.getRow(headerRowIndex + 1 + rIdx)
    columns.forEach((col, cIdx) => {
      const c = r.getCell(cIdx + 1)
      const v = pickCellValue(row, col, cIdx)
      c.value = v === undefined ? null : v
      if (col.numFmt) c.numFmt = col.numFmt
      if (col.align) c.alignment = { ...c.alignment, horizontal: col.align }
      c.border = {
        top: { style: 'thin', color: { argb: theme.borderColor } },
        bottom: { style: 'thin', color: { argb: theme.borderColor } },
        left: { style: 'thin', color: { argb: theme.borderColor } },
        right: { style: 'thin', color: { argb: theme.borderColor } },
      }
      if ((sheetSpec.zebra !== false) && rIdx % 2 === 1) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.zebraFill } }
      }
    })
  })

  // ---- 总计行 ----
  let lastContentRow = headerRowIndex + rows.length
  if (sheetSpec.totalRow) {
    const tr = ws.getRow(lastContentRow + 1)
    const label = (sheetSpec.totalRow.label || '合计')
    const sumKeys = Array.isArray(sheetSpec.totalRow.sumKeys) ? sheetSpec.totalRow.sumKeys : []
    columns.forEach((col, cIdx) => {
      const c = tr.getCell(cIdx + 1)
      if (cIdx === 0) {
        c.value = label
      } else if (sumKeys.includes(col._key)) {
        const sum = rows.reduce((acc, row) => {
          const v = Number(pickCellValue(row, col, cIdx))
          return acc + (Number.isFinite(v) ? v : 0)
        }, 0)
        c.value = sum
        if (col.numFmt) c.numFmt = col.numFmt
      }
      c.font = { bold: true }
      c.border = {
        top: { style: 'double', color: { argb: theme.headerFill } },
        bottom: { style: 'thin', color: { argb: theme.borderColor } },
        left: { style: 'thin', color: { argb: theme.borderColor } },
        right: { style: 'thin', color: { argb: theme.borderColor } },
      }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.totalFill } }
    })
    lastContentRow += 1
  }

  // ---- 冻结窗格（默认开；有标题行时连标题冻结）----
  if (sheetSpec.freeze !== false) {
    ws.views = [{ state: 'frozen', ySplit: headerRowIndex, xSplit: 0 }]
  }

  // ---- 表头筛选 ----
  if (sheetSpec.autofilter) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + rows.length, column: columns.length },
    }
  }

  // ---- 页签颜色 ----
  if (sheetSpec.tabColor) {
    ws.properties.tabColor = { argb: normalizeColor(sheetSpec.tabColor) }
  }

  // ---- 单元格级微调（最后应用，优先级最高）----
  applyCellOverrides(ws, sheetSpec.cells)

  return { name: sheetSpec.name, rows: rows.length, cols: columns.length }
}

/**
 * 生成报表文件
 * @param {object} spec 报表描述
 * @param {string} absPath 输出绝对路径（由调用方完成路径安全校验）
 * @returns {{filePath, sheetCount, totalRows, sheets: Array}}
 */
async function generateReport(spec, absPath) {
  const { theme } = validateSpec(spec)

  const wb = new ExcelJS.Workbook()
  wb.creator = '砼智 Concrete Agent'
  wb.created = new Date()

  const built = []
  let totalRows = 0
  for (const sheetSpec of spec.sheets) {
    const info = buildSheet(wb, sheetSpec, theme)
    totalRows += info.rows
    built.push(info)
  }

  await wb.xlsx.writeFile(absPath)
  return { filePath: absPath, sheetCount: built.length, totalRows, sheets: built }
}

module.exports = { generateReport, THEMES, normalizeColor, normalizeColumns, validateSpec }
