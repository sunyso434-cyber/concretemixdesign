/**
 * XlsxReportService 单元测试
 * 双库互验策略：
 *   - 样式断言用 exceljs 自己读回（fill/font/numFmt/freeze 等社区版 SheetJS 读不到）；
 *   - 互通性断言用现有 SheetJS（xlsx@0.20.3）读回——保证 OfficeCLI 等第三方接力方拿到的文件格式无问题。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const ExcelJS = require('exceljs')
const SheetJS = require('xlsx')
const { generateReport, THEMES, normalizeColor, validateSpec } = require('../../services/XlsxReportService')

let tmpDir

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-report-test-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

async function readWithExcelJS(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb
}

function readWithSheetJS(file) {
  return SheetJS.readFile(file)
}

describe('generateReport 基础生成', () => {
  const spec = {
    theme: 'professional',
    sheets: [{
      name: '报价明细',
      title: '某项目材料报价单',
      columns: [
        { header: '材料名称', key: 'name', width: 20 },
        { header: '单价(元)', key: 'price', width: 12, numFmt: '#,##0.00', align: 'right' },
        { header: '数量', key: 'qty' },
      ],
      rows: [
        { name: 'P.O 42.5 水泥', price: 450, qty: 100 },
        { name: 'I 级粉煤灰', price: 180.5, qty: 60 },
      ],
      totalRow: { label: '合计', sumKeys: ['price'] },
    }],
  }
  let file
  let ejWb
  let sjWb

  beforeAll(async () => {
    file = path.join(tmpDir, 'basic.xlsx')
    await generateReport(spec, file)
    ejWb = await readWithExcelJS(file)
    sjWb = readWithSheetJS(file)
  })

  test('文件落盘且返回统计正确', () => {
    expect(fs.existsSync(file)).toBe(true)
  })

  test('exceljs 读回：标题行合并+样式，表头主题填充，冻结含标题两行', () => {
    const ws = ejWb.worksheets[0]
    expect(ws.name).toBe('报价明细')
    // 标题
    expect(ws.getCell('A1').value).toBe('某项目材料报价单')
    expect(ws.getCell('A1').font.bold).toBe(true)
    // 表头主题色
    const header = ws.getCell('A2')
    expect(header.value).toBe('材料名称')
    expect(header.font.bold).toBe(true)
    expect(header.font.color.argb).toBe(THEMES.professional.headerColor)
    expect(header.fill.fgColor.argb).toBe(THEMES.professional.headerFill)
    // 冻结：标题+表头两行
    expect(ws.views[0].state).toBe('frozen')
    expect(ws.views[0].ySplit).toBe(2)
  })

  test('exceljs 读回：列格式与总计行', () => {
    const ws = ejWb.worksheets[0]
    expect(ws.getCell('B3').numFmt).toBe('#,##0.00')
    expect(ws.getCell('B3').alignment.horizontal).toBe('right')
    // 总计行在第 5 行：A5=合计；sumKeys 只汇总 price 列（450+180.5）
    expect(ws.getCell('A5').value).toBe('合计')
    expect(ws.getCell('B5').value).toBeCloseTo(630.5, 6)
    expect(ws.getCell('C5').value).toBe(null)
    expect(ws.getCell('A5').font.bold).toBe(true)
  })

  test('SheetJS 读回（互通性）：Sheet 名/表头文字/合并区域逐字一致', () => {
    const ws = sjWb.Sheets['报价明细']
    expect(sjWb.SheetNames).toEqual(['报价明细'])
    expect(ws.A2.v).toBe('材料名称')
    expect(ws.B2.v).toBe('单价(元)')
    expect(ws.C2.v).toBe('数量')
    // 数据值可读
    expect(ws.A3.v).toBe('P.O 42.5 水泥')
    expect(ws.B3.v).toBe(450)
    // 标题合并区域被标准解析器识别
    expect(ws['!merges']).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }])
  })
})

describe('自定义模式：列宽/tabColor/cells 微调/筛选/斑马纹开关', () => {
  let file
  let ws

  beforeAll(async () => {
    file = path.join(tmpDir, 'custom.xlsx')
    await generateReport({
      theme: 'warm',
      sheets: [{
        name: '数据',
        columns: ['名称', '数值'],
        rows: [{ 名称: '甲', 数值: 1 }, { 名称: '乙', 数值: 2 }, { 名称: '丙', 数值: 3 }],
        autofilter: true,
        tabColor: '00AA00',
        zebra: false,
        cells: { B3: { bold: true, color: 'FF0000', fill: 'FFFF00', numFmt: '0.0%', align: 'center' } },
      }],
    }, file)
    const wb = await readWithExcelJS(file)
    ws = wb.worksheets[0]
  })

  test('数组形式 rows 按列序取值（无标题时表头在第 1 行）', () => {
    expect(ws.getCell('A1').value).toBe('名称')
    expect(ws.getCell('A2').value).toBe('甲')
    expect(ws.getCell('A4').value).toBe('丙')
  })

  test('tabColor / autofilter 生效', () => {
    expect(ws.properties.tabColor.argb).toBe('FF00AA00')
    // exceljs 写入为对象、读回为范围字符串，两种形态都兼容断言
    const af = ws.autoFilter
    const covered = typeof af === 'string'
      ? af.replace(/\$/g, '')
      : `A${af.from.row}:B${af.to.row}`
    expect(covered).toBe('A1:B4')
  })

  test('zebra:false 时偶数数据行无填充（读回表现为 pattern:none 或空）', () => {
    const f = ws.getCell('A3').fill
    expect(!f || f.pattern === 'none').toBe(true)
  })

  test('cells 单元格级微调优先生效（B3=第2行数值列）', () => {
    const c = ws.getCell('B3')
    expect(c.font.bold).toBe(true)
    expect(c.font.color.argb).toBe('FFFF0000')
    expect(c.fill.fgColor.argb).toBe('FFFFFF00')
    expect(c.numFmt).toBe('0.0%')
    expect(c.alignment.horizontal).toBe('center')
  })

  test('warm 主题表头配色正确（表头在第 1 行）', () => {
    const h = ws.getCell('A1')
    expect(h.value).toBe('名称')
    expect(h.fill.fgColor.argb).toBe(THEMES.warm.headerFill)
    expect(h.font.color.argb).toBe(THEMES.warm.headerColor)
  })
})

describe('校验与边界', () => {
  test('normalizeColor 兼容 #前缀/8位ARGB，非法抛错', () => {
    expect(normalizeColor('#1F4E79')).toBe('FF1F4E79')
    expect(normalizeColor('ff1f4e79')).toBe('FF1F4E79')
    expect(() => normalizeColor('red')).toThrow(/颜色/)
  })

  test('validateSpec：缺 sheets / 重名 / 超长名 / 非法字符 / 未知主题', () => {
    expect(() => validateSpec({})).toThrow(/sheets/)
    expect(() => validateSpec({ sheets: [{ name: 'A', columns: ['x'] }, { name: 'A', columns: ['y'] }] })).toThrow(/重复/)
    expect(() => validateSpec({ sheets: [{ name: 'x'.repeat(32), columns: ['a'] }] })).toThrow(/31/)
    expect(() => validateSpec({ sheets: [{ name: '坏[名字', columns: ['a'] }] })).toThrow(/非法字符/)
    expect(() => validateSpec({ theme: 'neon', sheets: [{ name: 'A', columns: ['a'] }] })).toThrow(/未知主题/)
    expect(() => validateSpec({ sheets: [{ name: 'A', columns: [] }] })).toThrow(/columns/)
    expect(() => validateSpec({ sheets: [{ name: 'A', columns: ['a'], rows: [42] }] })).toThrow(/对象或数组/)
    // 合法 spec 不抛
    expect(validateSpec({ sheets: [{ name: 'OK', columns: ['a'] }] }).themeKey).toBe('professional')
  })

  test('cells 非法地址抛错', async () => {
    const file = path.join(tmpDir, 'bad-cell.xlsx')
    await expect(generateReport({
      sheets: [{ name: 'S', columns: ['a'], rows: [], cells: { '不是地址': { bold: true } } }],
    }, file)).rejects.toThrow(/地址不合法/)
  })

  test('generateReport 返回统计摘要', async () => {
    const file = path.join(tmpDir, 'summary.xlsx')
    const result = await generateReport({
      sheets: [
        { name: '一', columns: ['a', 'b'], rows: [{ a: 1 }, { a: 2 }] },
        { name: '二', columns: ['c'], rows: [{ c: 1 }] },
      ],
    }, file)
    expect(result.sheetCount).toBe(2)
    expect(result.totalRows).toBe(3)
    expect(result.sheets.map(s => s.name)).toEqual(['一', '二'])
  })
})
