const BlueprintEngine = require('../../../../services/BlueprintEngine')

describe('BlueprintEngine 集成', () => {
  let engine

  beforeEach(() => {
    engine = new BlueprintEngine({
      materialsIndex: {
        '水泥': [{ name: 'P.O42.5', compressiveStrength28d: 42.5 }]
      },
      tables: {}
    })
  })

  test('完整流程：input → const → formula → output', async () => {
    const result = await engine.run({
      steps: [
        { type: 'input', var: 'a', default: 10 },
        { type: 'const', var: 'b', value: 5 },
        { type: 'formula', var: 'c', expr: 'a + b' },
        { type: 'output', var: 'c', name: '和', unit: '' }
      ]
    }, {})
    expect(result.results.c).toEqual({ name: '和', value: 15, unit: '' })
  })

  test('致命错误中断执行', async () => {
    await expect(engine.run({
      steps: [
        { type: 'formula', var: 'c', expr: 'undefined_var + 1' }
      ]
    }, {})).rejects.toThrow(/尚未定义/)
  })
})
