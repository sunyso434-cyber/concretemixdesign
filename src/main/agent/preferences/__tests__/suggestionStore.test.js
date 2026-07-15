const { SuggestionStore } = require('../suggestionStore')
const { PreferenceSuggestion, sequelize } = require('../../../db/database')

const sampleSuggestion = (overrides = {}) => ({
  id: 'sugg-1',
  type: 'material_vendor',
  title: '测试建议',
  proposedYaml: { category: '水泥', dimension: '厂家', value: '拉法基' },
  reason: '5次中5次',
  confidence: 1.0,
  createdAt: new Date(),
  status: 'pending',
  ...overrides
})

describe('SuggestionStore', () => {
  let store

  beforeAll(async () => {
    await sequelize.sync()
  })

  beforeEach(async () => {
    store = new SuggestionStore()
    await PreferenceSuggestion.destroy({ truncate: true })
  })

  afterAll(async () => {
    await sequelize.close()
  })

  test('add 持久化建议及完整 payload', async () => {
    const row = await store.add(sampleSuggestion())
    const list = await store.list()

    expect(list).toHaveLength(1)
    expect(row.payload.proposedYaml.value).toBe('拉法基')
    expect(row.confidence).toBe(1.0)
  })

  test('同类型 pending 建议会去重', async () => {
    const first = await store.add(sampleSuggestion())
    const second = await store.add(sampleSuggestion({ id: 'sugg-2' }))

    expect(second.id).toBe(first.id)
    expect(await store.list()).toHaveLength(1)
  })

  test('get 按数据库主键读取建议', async () => {
    const row = await store.add(sampleSuggestion())
    const fetched = await store.get(row.id)

    expect(fetched.id).toBe(row.id)
    expect(fetched.type).toBe('material_vendor')
  })

  test('remove 删除指定建议', async () => {
    const row = await store.add(sampleSuggestion())

    expect(await store.remove(row.id)).toBe(1)
    expect(await store.get(row.id)).toBeNull()
  })

  test('clear 只删除 pending 建议', async () => {
    await store.add(sampleSuggestion())
    await PreferenceSuggestion.create({
      type: 'method_preference',
      payload: sampleSuggestion({ type: 'method_preference' }),
      confidence: 0.9,
      status: 'accepted'
    })

    expect(await store.clear()).toBe(1)
    expect(await store.list()).toEqual([])
    expect(await PreferenceSuggestion.count({ where: { status: 'accepted' } })).toBe(1)
  })
})
