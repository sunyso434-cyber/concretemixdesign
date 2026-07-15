const utils = require('../MixDesignOptimizerUtils')

describe('MixDesignOptimizerUtils', () => {
  const sands = [
    { id: 1, name: '机制砂', price: 100, finenessModulus: 3.0, mudContent: 1, mbValue: 0.4 },
    { id: 2, name: '河砂', price: 200, finenessModulus: 2.0, mudContent: 2, mbValue: 0.8 },
    { id: 3, name: '细砂', price: 150, finenessModulus: 1.8, mudContent: 1.5, mbValue: 0.6 }
  ]

  test('三种砂只生成两两组合，符合两个配料仓限制', () => {
    const ratios = utils.generateFineAggregateRatios(sands)
    expect(ratios).toHaveLength(3 * 21)
    expect(new Set(ratios.map(ratio => `${ratio[2]}-${ratio[3]}`))).toEqual(
      new Set(['0-1', '0-2', '1-2'])
    )
  })

  test('混合砂按比例加权并保留原材料来源', () => {
    const result = utils.blendFineAggregatesForCost(sands, [0.25, 0.75, 0, 1])
    expect(result.price).toBe(175)
    expect(result.finenessModulus).toBe(2.25)
    expect(result.originalAggregateIds).toEqual([1, 2])
  })

  test('构建迭代材料时不修改原对象', () => {
    const base = { cement: { id: 9 }, sand: sands.slice(0, 2) }
    const result = utils.buildIterationMaterials(base, { sand: [0.5, 0.5] })
    expect(result).not.toBe(base)
    expect(base.sand).toHaveLength(2)
    expect(result.sand.name).toBe('混合砂')
  })

  test('范围不能整除时仍包含最大端点', () => {
    expect(utils.createRange([0, 10], 4)).toEqual([0, 4, 8, 10])
  })

  test('约束校验覆盖水胶比、胶凝材料和用水量边界', () => {
    const valid = {
      targetStrength: 38,
      waterRatio: 0.5,
      materials: { cement: 300, flyAsh: 50, water: 170 }
    }
    expect(utils.validateConstraints(valid, { strength: 'C30' }, { waterRatioRange: [0.4, 0.6] })).toBe(true)
    expect(utils.validateConstraints({ ...valid, waterRatio: 0.7 }, { strength: 'C30' }, { waterRatioRange: [0.4, 0.6] })).toBe(false)
    expect(utils.validateConstraints({ ...valid, materials: { cement: 100, water: 170 } }, { strength: 'C30' })).toBe(false)
    expect(utils.validateConstraints({ ...valid, materials: { cement: 300, water: 260 } }, { strength: 'C30' })).toBe(false)
  })

  test('空材料仍保留一次下游迭代机会', () => {
    expect(utils.getMaterialList([])).toEqual([null])
    expect(utils.getMaterialList(null)).toEqual([null])
  })
})
