const { validate, ValidationError } =
  require('../../../services/BlueprintEngine/BlueprintValidator')

describe('BlueprintValidator', () => {
  test('合法蓝图通过', () => {
    const blueprint = {
      steps: [
        { type: 'input', var: 'a', default: 1 },
        { type: 'formula', var: 'b', expr: 'a * 2' }
      ]
    }
    expect(() => validate(blueprint)).not.toThrow()
  })

  test('操作类型不合法', () => {
    expect(() => validate({ steps: [{ type: 'unknown', var: 'a' }] }))
      .toThrow(/不合法/)
  })

  test('material 操作禁止写 name', () => {
    expect(() => validate({
      steps: [{
        type: 'material', var: 'x',
        material_query: { category: '水泥', name: 'P.O42.5', property: 'compressiveStrength28d' }
      }]
    })).toThrow(/禁止写.*name/)
  })

  test('material category 必须支持', () => {
    expect(() => validate({
      steps: [{
        type: 'material', var: 'x',
        material_query: { category: '硅灰', property: 'compressiveStrength28d' }
      }]
    })).toThrow(/不支持/)
  })

  test('material property 必须在允许列表中', () => {
    expect(() => validate({
      steps: [{
        type: 'material', var: 'x',
        material_query: { category: '粗骨料', property: 'apparentDensity' }
      }]
    })).toThrow(/不允许/)
  })

  test('公式自引用', () => {
    expect(() => validate({
      steps: [{ type: 'formula', var: 'a', expr: 'a + 1' }]
    })).toThrow(/自引用/)
  })
})
