const handleTableLookup = require('../../../../services/BlueprintEngine/handlers/tableLookup')

describe('handleTableLookup', () => {
  let cm, tables
  beforeEach(() => {
    cm = { set: jest.fn(), get: jest.fn() }
    tables = {
      '用水量': {
        dimensions: [
          { name: '坍落度', values: [40, 90, 180] },
          { name: '最大粒径', values: [10, 20, 40] }
        ],
        data: [
          [190, 170, 160],
          [200, 185, 175],
          [215, 200, 190]
        ]
      }
    }
  })

  test('bilinear 插值 + $ 变量引用', async () => {
    cm.get.mockImplementation(name => ({ slump: 90, dmax: 20 }[name]))
    await handleTableLookup({
      var: 'm_wo', table: '用水量', lookup_mode: 'bilinear',
      keys: { 坍落度: '$slump', 最大粒径: '$dmax' }
    }, cm, tables)
    expect(cm.set).toHaveBeenCalledWith('m_wo', 185)
  })

  test('表不存在 → 抛错', async () => {
    await expect(handleTableLookup({
      var: 'x', table: '不存在的表', lookup_mode: 'linear', keys: { x: 5 }
    }, cm, tables)).rejects.toThrow(/数据表"不存在的表"不存在/)
  })
})
