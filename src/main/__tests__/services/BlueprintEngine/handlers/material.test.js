const handleMaterial = require('../../../../services/BlueprintEngine/handlers/material')

describe('handleMaterial', () => {
  let cm, materialsIndex
  beforeEach(() => {
    cm = { set: jest.fn() }
    materialsIndex = {
      '水泥': [
        { name: 'P.O42.5', compressiveStrength28d: 42.5 },
        { name: 'P.O52.5', compressiveStrength28d: 52.5 }
      ]
    }
  })

  test('按 category 过滤 + 唯一候选 → 直接使用', async () => {
    materialsIndex['水泥'] = [{ name: 'P.O42.5', compressiveStrength28d: 42.5 }]
    await handleMaterial({
      var: 'cement_strength',
      material_query: { category: '水泥', property: 'compressiveStrength28d' }
    }, cm, materialsIndex, {})
    expect(cm.set).toHaveBeenCalledWith('cement_strength', 42.5)
  })

  test('按 requirements 过滤', async () => {
    await handleMaterial({
      var: 'cement_strength',
      material_query: {
        category: '水泥',
        requirements: [{ property: 'compressiveStrength28d', min: 50 }],
        property: 'compressiveStrength28d'
      }
    }, cm, materialsIndex, {})
    expect(cm.set).toHaveBeenCalledWith('cement_strength', 52.5) // P.O52.5 满足 ≥50
  })

  test('无候选 → 报错', async () => {
    materialsIndex['水泥'] = []
    await expect(handleMaterial({
      var: 'x',
      material_query: { category: '水泥', property: 'compressiveStrength28d' }
    }, cm, materialsIndex, {})).rejects.toThrow(/没有"水泥"类材料/)
  })

  test('requirements 过滤后无候选 → 报错并列出要求', async () => {
    await expect(handleMaterial({
      var: 'x',
      material_query: {
        category: '水泥',
        requirements: [{ property: 'compressiveStrength28d', min: 100 }],
        property: 'compressiveStrength28d'
      }
    }, cm, materialsIndex, {})).rejects.toThrow(/没有满足性能要求的材料/)
  })
})