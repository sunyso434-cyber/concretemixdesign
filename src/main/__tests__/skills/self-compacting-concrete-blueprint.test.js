/**
 * 自密实混凝土蓝图端到端测试 (JGJ/T 283)
 *
 * 验证：浆体体积倒推水胶比流程能正常执行
 */
const path = require('path')
const yaml = require('js-yaml')
const fs = require('fs')
const BlueprintEngine = require('../../services/BlueprintEngine')

describe('自密实混凝土蓝图', () => {
  let engine
  let blueprint

  beforeAll(() => {
    const bpPath = path.join(__dirname, '..', 'fixtures', 'skills', '自密实混凝土_配合比设计', 'blueprint.yaml')
    blueprint = yaml.load(fs.readFileSync(bpPath, 'utf8'))
  })

  beforeEach(() => {
    engine = new BlueprintEngine({
      materialsIndex: {
        '水泥': [{ name: 'P.O42.5', compressiveStrength28d: 42.5, density: 3.10 }],
        '粗骨料': [{ name: '碎石5-20mm', density: 2.70 }]
      },
      tables: {}
    })
  })

  test('C40 自密实混凝土可执行', async () => {
    const result = await engine.run(
      { steps: blueprint.blueprint.steps },
      {
        strength_grade: 'C40',
        slump_flow: 650,
        max_agg_size: '20',
        paste_volume: 360
      })

    expect(result.results).toBeDefined()
    // 水泥应 > 350 kg/m³（自密实胶材较多）
    expect(result.results.cement_mass.value).toBeGreaterThan(350)
    // 水胶比应在 0.30~0.50
    expect(result.results.wb.value).toBeGreaterThan(0.30)
    expect(result.results.wb.value).toBeLessThan(0.50)
    // 浆体体积输出
    expect(result.results.paste_volume.value).toBe(360)
  })

  test('不同浆体体积影响胶材用量', async () => {
    const steps = { steps: blueprint.blueprint.steps }
    // 每次创建新引擎避免上下文缓存
    const e360 = new BlueprintEngine({ materialsIndex: { '水泥': [{ name: 'P.O42.5', compressiveStrength28d: 42.5, density: 3.10 }], '粗骨料': [{ name: '碎石', density: 2.70 }] }, tables: {} })
    const r360 = await e360.run(steps, { strength_grade: 'C40', slump_flow: 650, max_agg_size: '20', paste_volume: 360 })

    const e400 = new BlueprintEngine({ materialsIndex: { '水泥': [{ name: 'P.O42.5', compressiveStrength28d: 42.5, density: 3.10 }], '粗骨料': [{ name: '碎石', density: 2.70 }] }, tables: {} })
    const r400 = await e400.run(steps, { strength_grade: 'C40', slump_flow: 650, max_agg_size: '20', paste_volume: 400 })

    // 浆体越多 → 胶材越多
    expect(r400.results.cement_mass.value).toBeGreaterThan(r360.results.cement_mass.value)
  })
})
