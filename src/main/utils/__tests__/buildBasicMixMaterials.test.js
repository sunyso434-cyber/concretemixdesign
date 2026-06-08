/**
 * buildBasicMixMaterials 测试
 *
 * 关键 bug 场景（老板 2026-06-08 报告）：
 * - 配合比设计草稿保存时漏掉了 materialDetails 字段
 * - 旧版 buildMaterialsArray 拿不到 id，把所有 materialId 存成 null
 * - 报价时按 null 查价格，触发"水泥没有单价，无法准确报价"
 *
 * 修复策略（双保险）：
 *   1. calculate_mix_design skill 保存草稿时正确写入 materialDetails
 *   2. buildBasicMixMaterials 在 materialDetails 缺失时按"材料名/类型"反查 materialId
 *
 * 本测试覆盖方向 2（兜底），保证即便上游漏写 materialDetails，报价时也能查到价格。
 */

const { buildBasicMixMaterials } = require('../buildBasicMixMaterials')

const materialLib = [
  { id: 25, name: 'P·O 42.5R水泥（拉法基）', type: '水泥', price: 300 },
  { id: 40, name: '锂渣（青白江）', type: '锂渣', price: 65 },
  { id: 41, name: '复合粉（拉法基）', type: '复合粉', price: 110 },
  { id: 7, name: '机制砂（汶川）', type: '细骨料', price: 89 },
  { id: 9, name: '碎石（汶川5-25mm）', type: '粗骨料', price: 85 },
  { id: 11, name: 'SSJS（同升）', type: '减水剂', price: 1400 },
  { id: 100, name: '水', type: '其他', price: 0 }
]

describe('buildBasicMixMaterials materialId 反查', () => {
  test('首选：使用 materialDetails 中的 id（最常见路径）', () => {
    const result = buildBasicMixMaterials({
      materials: { cement: 274.67, lithiumSlag: 43.37, compositePowder: 43.37, sand: 839, stone: 1028.29, water: 164.11 },
      selected: {
        cement: { id: 25, name: 'P·O 42.5R水泥（拉法基）' },
        lithiumSlag: { id: 40, name: '锂渣（青白江）' },
        compositePowder: { id: 41, name: '复合粉（拉法基）' },
        sand: { id: 7, name: '机制砂（汶川）' },
        stone: { id: 9, name: '碎石（汶川5-25mm）' }
      },
      allMaterials: materialLib
    })

    const byType = Object.fromEntries(result.map(m => [m.materialType, m]))
    expect(byType['水泥'].materialId).toBe(25)
    expect(byType['锂渣'].materialId).toBe(40)
    expect(byType['复合粉'].materialId).toBe(41)
    expect(byType['细骨料'].materialId).toBe(7)
    expect(byType['粗骨料'].materialId).toBe(9)
    expect(byType['水'].materialId).toBe(100)
  })

  test('【bug 复现】materialDetails 完全缺失时，按材料名/类型反查 id 兜底', () => {
    // 模拟 bug：mix-design.js 没把 materialDetails 写进草稿
    const result = buildBasicMixMaterials({
      materials: { cement: 274.67, lithiumSlag: 43.37, compositePowder: 43.37, sand: 839, stone: 1028.29, water: 164.11 },
      selected: {}, // 模拟 materialDetails 缺失
      allMaterials: materialLib
    })

    const byType = Object.fromEntries(result.map(m => [m.materialType, m]))
    // 关键断言：即便没传 id，兜底反查也要拿到正确 id
    expect(byType['水泥'].materialId).toBe(25)
    expect(byType['锂渣'].materialId).toBe(40)
    expect(byType['复合粉'].materialId).toBe(41)
    expect(byType['细骨料'].materialId).toBe(7)
    expect(byType['粗骨料'].materialId).toBe(9)
    expect(byType['水'].materialId).toBe(100)
    // 名称也要正确
    expect(byType['水泥'].materialName).toBe('P·O 42.5R水泥（拉法基）')
    expect(byType['锂渣'].materialName).toBe('锂渣（青白江）')
  })

  test('【混合砂石】用 fineBreakdown/coarseBreakdown 时，按 name 反查 id', () => {
    const result = buildBasicMixMaterials({
      materials: { cement: 300, water: 160 },
      selected: { cement: { id: 25, name: 'P·O 42.5R水泥（拉法基）' } },
      fineBreakdown: [
        { id: null, name: '机制砂（汶川）', amount: 500 },
        { id: null, name: '河砂（乐山）', amount: 300 }
      ],
      coarseBreakdown: [
        { id: 8, name: '卵石（5-20mm，绵阳）', amount: 1000 }
      ],
      allMaterials: [
        ...materialLib,
        { id: 8, name: '卵石（5-20mm，绵阳）', type: '粗骨料', price: 100 },
        { id: 10, name: '河砂（乐山）', type: '细骨料', price: 93 }
      ]
    })

    const fine = result.filter(m => m.materialType === '细骨料')
    const coarse = result.filter(m => m.materialType === '粗骨料')
    expect(fine).toHaveLength(2)
    expect(fine.find(f => f.materialName === '机制砂（汶川）').materialId).toBe(7)
    expect(fine.find(f => f.materialName === '河砂（乐山）').materialId).toBe(10)
    expect(coarse).toHaveLength(1)
    expect(coarse[0].materialId).toBe(8)
  })

  test('极端：材料库为空 + materialDetails 缺失时，所有 id 兜底为 null（不抛错）', () => {
    const result = buildBasicMixMaterials({
      materials: { cement: 274, water: 160 },
      selected: {},
      allMaterials: []
    })
    expect(result).toHaveLength(2)
    expect(result[0].materialId).toBeNull()
    expect(result[1].materialId).toBeNull()
  })

  test('不写入用量为 0 的材料（不影响报价准确性）', () => {
    const result = buildBasicMixMaterials({
      materials: { cement: 274, flyAsh: 0, slag: 0, lithiumSlag: 43, compositePowder: 43, water: 160 },
      selected: {},
      allMaterials: materialLib
    })
    const types = result.map(m => m.materialType)
    expect(types).not.toContain('粉煤灰')
    expect(types).not.toContain('矿渣粉')
    expect(types).toContain('锂渣')
    expect(types).toContain('复合粉')
  })
})
