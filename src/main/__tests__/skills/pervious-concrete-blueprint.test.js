/**
 * 透水混凝土蓝图端到端测试
 *
 * 验证：非水胶比驱动流程（目标孔隙率驱动）能正常执行
 */
const path = require('path')
const yaml = require('js-yaml')
const fs = require('fs')
const BlueprintEngine = require('../../services/BlueprintEngine')

describe('透水混凝土蓝图', () => {
  let engine
  let blueprint

  beforeAll(() => {
    const bpPath = path.join(__dirname, '..', 'fixtures', 'skills', '透水混凝土', 'blueprint.yaml')
    blueprint = yaml.load(fs.readFileSync(bpPath, 'utf8'))
  })

  beforeEach(() => {
    engine = new BlueprintEngine({
      materialsIndex: {
        '水泥': [{ name: 'P.O42.5', compressiveStrength28d: 42.5 }],
        '粗骨料': [{ name: '碎石5-16mm', density: 2.70 }]
      },
      tables: {}
    })
  })

  test('透水混凝土蓝图可执行（孔隙率20%）', async () => {
    const result = await engine.run(
      { steps: blueprint.blueprint.steps },
      {
        target_porosity: 20,
        max_agg_size: 16,
        strength_grade: 'C25'
      })

    expect(result.results).toBeDefined()
    // 粗骨料用量应 > 1000 kg/m³
    expect(result.results.coarse_agg_mass.value).toBeGreaterThan(1000)
    // 水泥用量应 > 200 kg/m³
    expect(result.results.cement_mass.value).toBeGreaterThan(200)
    // 水胶比 = 0.30
    expect(result.results.wb.value).toBeCloseTo(0.30, 3)
    // 目标孔隙率 = 20%
    expect(result.results.target_porosity.value).toBe(20)
  })

  test('孔隙率30%（高透水）执行通过', async () => {
    const result = await engine.run(
      { steps: blueprint.blueprint.steps },
      {
        target_porosity: 30,
        max_agg_size: '16',
        strength_grade: 'C25'
      })

    // 高孔隙率 → 骨料应降低（30% vs 20%）
    expect(result.results.coarse_agg_mass.value).toBeGreaterThan(500)
    expect(result.results.coarse_agg_mass.value).toBeLessThan(1500)
    expect(result.results.cement_mass.value).toBeGreaterThan(100)
  })
})
