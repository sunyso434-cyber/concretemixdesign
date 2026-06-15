const { PreferencePatternDetector } = require('../PreferencePatternDetector')

const sampleArgs = (overrides = {}) => ({
  cementId: 1,
  flyAshId: null,
  slagId: null,
  superplasticizerId: null,
  calculationMethod: null,
  ...overrides
})

const existingPrefs = () => ({ materials: [], method: null })
const existingBlacklist = () => []
const observationLog = () => []

describe('PreferencePatternDetector', () => {
  let detector
  beforeEach(() => {
    detector = new PreferencePatternDetector({
      existingMaterials: existingPrefs().materials,
      existingMethod: null,
      existingBlacklist: existingBlacklist(),
      observationLog: observationLog()
    })
  })

  test('5 次都选同一厂家，应生成 material_vendor 建议', () => {
    for (let i = 0; i < 5; i++) {
      detector.observe(sampleArgs(), {
        materialNames: { 1: '拉法基', 2: '粉煤灰', 3: '西卡' }
      })
    }
    const suggestions = detector.flushSuggestions()
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].type).toBe('material_vendor')
    expect(suggestions[0].proposedYaml).toEqual({
      category: '水泥', dimension: '厂家', value: '拉法基'
    })
    expect(suggestions[0].confidence).toBe(1.0)
  })

  test('5 次中 4 次相同（80%），应生成建议', () => {
    for (let i = 0; i < 4; i++) {
      detector.observe(sampleArgs(), { materialNames: { 1: '拉法基', 2: '粉煤灰', 3: '西卡' } })
    }
    detector.observe(
      sampleArgs({ cementId: 99 }),
      { materialNames: { 1: '拉法基', 2: '粉煤灰', 3: '西卡', 99: '海螺' } }
    )
    const suggestions = detector.flushSuggestions()
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].proposedYaml.value).toBe('拉法基')
    expect(suggestions[0].confidence).toBe(0.8)
  })

  test('5 次中只有 3 次相同（60%），不应生成建议', () => {
    for (let i = 0; i < 3; i++) {
      detector.observe(sampleArgs(), { materialNames: { 1: '拉法基' } })
    }
    for (let i = 0; i < 2; i++) {
      detector.observe(sampleArgs({ cementId: 99 }), { materialNames: { 1: '拉法基', 99: '海螺' } })
    }
    const suggestions = detector.flushSuggestions()
    expect(suggestions).toHaveLength(0)
  })

  test('已存在 agent.md.materials 的偏好不应重复建议', () => {
    detector = new PreferencePatternDetector({
      existingMaterials: [{ category: '水泥', dimension: '厂家', value: '拉法基' }],
      existingMethod: null,
      existingBlacklist: [],
      observationLog: []
    })
    for (let i = 0; i < 5; i++) {
      detector.observe(sampleArgs(), { materialNames: { 1: '拉法基' } })
    }
    const suggestions = detector.flushSuggestions()
    expect(suggestions).toHaveLength(0)
  })

  test('已黑名单类型不应生成建议', () => {
    detector = new PreferencePatternDetector({
      existingMaterials: [],
      existingMethod: null,
      existingBlacklist: ['material_vendor'],
      observationLog: []
    })
    for (let i = 0; i < 5; i++) {
      detector.observe(sampleArgs(), { materialNames: { 1: '拉法基' } })
    }
    const suggestions = detector.flushSuggestions()
    expect(suggestions).toHaveLength(0)
  })

  test('calculationMethod 字段正确映射到 method_preference', () => {
    for (let i = 0; i < 5; i++) {
      detector.observe(
        sampleArgs({ calculationMethod: 'absolute' }),
        { materialNames: {} }
      )
    }
    const suggestions = detector.flushSuggestions()
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].type).toBe('method_preference')
    expect(suggestions[0].proposedYaml).toEqual({ method: '体积法' })
  })

  test('采纳后保留未建议项的观察历史（部分清空）', () => {
    // 5 次中 5 次选水泥 A → 应建议水泥 A
    for (let i = 0; i < 5; i++) {
      detector.observe(
        sampleArgs({ flyAshId: 2 }),
        { materialNames: { 1: 'A', 2: '粉煤灰' } }
      )
    }
    let suggestions = detector.flushSuggestions()
    expect(suggestions.find(s => s.proposedYaml.value === 'A')).toBeTruthy()

    // 采纳水泥 A → 清空 (水泥, 厂家) 项，但保留 (掺合料, 种类) 观察
    detector.markAccepted(['material_vendor'])

    // 继续 5 次都选粉煤灰 → 应建议粉煤灰
    for (let i = 0; i < 5; i++) {
      detector.observe(
        sampleArgs({ flyAshId: 2 }),
        { materialNames: { 1: 'A', 2: '粉煤灰' } }
      )
    }
    suggestions = detector.flushSuggestions()
    expect(suggestions.find(s => s.type === 'material_category')).toBeTruthy()
  })
})