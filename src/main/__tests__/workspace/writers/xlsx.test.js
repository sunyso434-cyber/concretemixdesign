// xlsx writer 测试
// - 多 sheet
// - 合并单元格（type: 'table' 含 merges: [{r, c}]）
// - 列宽（type: 'table' 含 colWidths: [number]）
const { write } = require('../../../workspace/writers/xlsx')
const { validateXlsxStructure } = require('./helpers')
const xlsx = require('xlsx')

describe('xlsx writer', () => {
  test('生成单 sheet xlsx', async () => {
    const buf = await write({
      title: 't',
      sections: [
        { type: 'table', sheetName: 'Sheet1', rows: [['列1', '列2'], ['a', 'b']] }
      ]
    })
    expect(buf).toBeInstanceOf(Buffer)
    expect(validateXlsxStructure(buf)).toBe(true)
  })

  test('多 sheet xlsx', async () => {
    const buf = await write({
      title: 't',
      sections: [
        { type: 'table', sheetName: '材料', rows: [['名称', '用量'], ['水泥', '350']] },
        { type: 'table', sheetName: '强度', rows: [['等级', '水胶比'], ['C30', '0.45']] }
      ]
    })
    expect(validateXlsxStructure(buf)).toBe(true)
    // 解出来验证 sheet 数
    const wb = xlsx.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['材料', '强度'])
  })

  test('合并单元格', async () => {
    const buf = await write({
      title: 't',
      sections: [
        {
          type: 'table',
          sheetName: '合并',
          rows: [['A1', 'A1', 'B2'], ['A2', 'B1', 'B2']],
          merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] // 合并 A1 横向 2 列
        }
      ]
    })
    expect(validateXlsxStructure(buf)).toBe(true)
    const wb = xlsx.read(buf, { type: 'buffer' })
    const ws = wb.Sheets['合并']
    expect(ws['!merges']).toBeDefined()
    expect(ws['!merges'].length).toBe(1)
    expect(ws['!merges'][0].s.c).toBe(0)
    expect(ws['!merges'][0].e.c).toBe(1)
  })

  test('列宽', async () => {
    const buf = await write({
      title: 't',
      sections: [
        {
          type: 'table',
          sheetName: '列宽',
          rows: [['窄', '宽列']],
          colWidths: [{ wch: 5 }, { wch: 30 }]
        }
      ]
    })
    expect(validateXlsxStructure(buf)).toBe(true)
    // SheetJS 0.18.5 默认不解析 !cols，必须 cellStyles:true
    const wb = xlsx.read(buf, { type: 'buffer', cellStyles: true })
    const ws = wb.Sheets['列宽']
    expect(ws['!cols']).toBeDefined()
    expect(ws['!cols'].length).toBe(2)
    // wch 是我们写入的；width 是 Excel 内部值（wch 转像素）
    expect(ws['!cols'][0].wch).toBe(5)
    expect(ws['!cols'][1].wch).toBe(30)
  })

  test('空 sections 生成空 workbook', async () => {
    const buf = await write({ title: 't', sections: [] })
    expect(validateXlsxStructure(buf)).toBe(true)
    const wb = xlsx.read(buf, { type: 'buffer' })
    // 默认带一个 Sheet1
    expect(wb.SheetNames.length).toBeGreaterThanOrEqual(1)
  })
})