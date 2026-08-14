/**
 * v0.9.x 输出优化：resultToTableData 单元测试
 */
const { resultToTableData } = require('../toolResultTable')

describe('resultToTableData', () => {
  test('非对象/标量/字符串返回 null', () => {
    expect(resultToTableData(null)).toBeNull()
    expect(resultToTableData(undefined)).toBeNull()
    expect(resultToTableData('ok')).toBeNull()
    expect(resultToTableData(42)).toBeNull()
    expect(resultToTableData({ ok: true, message: '完成' })).toBeNull()
  })

  test('items 数组转表格', () => {
    const r = resultToTableData({
      ok: true,
      items: [
        { name: '水泥 P.O42.5', price: 380, unit: '元/吨' },
        { name: '砂', price: 95, unit: '元/吨' },
      ],
    })
    expect(r).not.toBeNull()
    expect(r.columns.map(c => c.title)).toEqual(['name', 'price', 'unit'])
    expect(r.data).toHaveLength(2)
    expect(r.data[0]).toMatchObject({ name: '水泥 P.O42.5', price: '380' })
  })

  test('rows/data/list/records 均可识别', () => {
    for (const key of ['rows', 'data', 'list', 'records']) {
      const r = resultToTableData({ [key]: [{ a: 1 }] })
      expect(r).not.toBeNull()
      expect(r.data).toHaveLength(1)
    }
  })

  test('materials（材料库查询）可识别', () => {
    const r = resultToTableData({
      success: true,
      count: 2,
      materials: [
        { name: 'I级粉煤灰', price: 220, status: '正常' },
        { name: 'II级粉煤灰', price: 150, status: '正常' },
      ],
    })
    expect(r).not.toBeNull()
    expect(r.columns.map(c => c.title)).toEqual(['name', 'price', 'status'])
    expect(r.data).toHaveLength(2)
    expect(r.data[0]).toMatchObject({ name: 'I级粉煤灰', price: '220' })
  })

  test('嵌套对象值 JSON 字符串化，null 变空串', () => {
    const r = resultToTableData({ items: [{ name: 'x', detail: { grade: 'C30' }, extra: null }] })
    expect(r.data[0].detail).toBe(JSON.stringify({ grade: 'C30' }))
    expect(r.data[0].extra).toBe('')
  })

  test('超过 50 行截断、超过 8 列截断', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ a: i }))
    const wide = Array.from({ length: 12 }, (_, k) => k).reduce((acc, k) => ({ ...acc, [`k${k}`]: k }), {})
    const r1 = resultToTableData({ items: rows })
    expect(r1.data).toHaveLength(50)
    const r2 = resultToTableData({ items: [wide, wide] })
    expect(r2.columns).toHaveLength(8)
  })
})
