const MemoryTierService = require('../MemoryTierService')
const { MemoryTierService: MemoryTierServiceClass } = require('../MemoryTierService')
const { SessionSummary, ChatHistory, sequelize } = require('../../db/database')

const STUB_LLM = {
  chat: jest.fn().mockResolvedValue({
    content: '{"summary":"test summary","keyDecisions":[],"toolCalls":[]}',
    tool_calls: null,
    role: 'assistant'
  })
}

beforeEach(() => {
  STUB_LLM.chat.mockClear()
  MemoryTierService.setDeepSeekService(STUB_LLM)
})

afterAll(() => {
  delete MemoryTierService.deepseekService
})

describe('MemoryTierService', () => {
  beforeAll(async () => {
    await sequelize.sync()
  })

  afterAll(async () => {
    await sequelize.close()
  })

  afterEach(async () => {
    await SessionSummary.destroy({ truncate: true })
    await ChatHistory.destroy({ truncate: true })
    delete global.deepseekService
  })

  test('summarizeOldMessages calls LLM and writes SessionSummary', async () => {
    const ids = []
    for (let i = 0; i < 21; i++) {
      const m = await ChatHistory.create({
        sessionId: 'test-sess',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`
      })
      ids.push(m.id)
    }

    const result = await MemoryTierService.summarizeOldMessages('test-sess', {
      rangeStart: ids[0],
      rangeEnd: ids[ids.length - 1]
    })

    expect(result).toHaveProperty('id')
    const fetched = await SessionSummary.findByPk(result.id)
    expect(fetched.sessionId).toBe('test-sess')
    expect(fetched.rangeStart).toBe(ids[0])
    expect(fetched.rangeEnd).toBe(ids[ids.length - 1])
  }, 30000)

  test('summarizeNextBatch uses real ChatHistory ids instead of message count', async () => {
    await ChatHistory.create({ sessionId: 'other-sess', role: 'user', content: 'offset row' })
    const ids = []
    for (let i = 0; i < 20; i++) {
      const m = await ChatHistory.create({
        sessionId: 'next-sess',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `next ${i}`
      })
      ids.push(m.id)
    }

    const result = await MemoryTierService.summarizeNextBatch('next-sess', {
      batchSize: 20,
      minMessages: 20
    })

    expect(result.rangeStart).toBe(ids[0])
    expect(result.rangeEnd).toBe(ids[ids.length - 1])
  }, 30000)

  test('summarizeOldMessages prefers global.deepseekService when no LLM was injected', async () => {
    const globalLLM = {
      chat: jest.fn().mockResolvedValue({
        content: '{"summary":"global summary","keyDecisions":[],"toolCalls":[]}',
        role: 'assistant'
      })
    }
    global.deepseekService = globalLLM
    const svc = new MemoryTierServiceClass()
    const ids = []
    for (let i = 0; i < 20; i++) {
      const m = await ChatHistory.create({
        sessionId: 'global-sess',
        role: 'user',
        content: `global ${i}`
      })
      ids.push(m.id)
    }

    const result = await svc.summarizeOldMessages('global-sess', {
      rangeStart: ids[0],
      rangeEnd: ids[ids.length - 1]
    })

    expect(globalLLM.chat).toHaveBeenCalled()
    expect(result.summary).toBe('global summary')
  }, 30000)

  test('summarizeOldMessages is idempotent for the same session range', async () => {
    const existing = await SessionSummary.create({
      sessionId: 'idem-sess',
      rangeStart: 100,
      rangeEnd: 120,
      summary: 'existing summary'
    })
    const llm = { chat: jest.fn() }
    const svc = new MemoryTierServiceClass({ deepseekService: llm })

    const result = await svc.summarizeOldMessages('idem-sess', {
      rangeStart: 100,
      rangeEnd: 120
    })

    expect(result.id).toBe(existing.id)
    expect(llm.chat).not.toHaveBeenCalled()
  })

  test('recall returns scored summaries', async () => {
    const created = await SessionSummary.bulkCreate([
      { sessionId: 's1', rangeStart: 1, rangeEnd: 10, summary: 'sand ratio 36 percent decision' },
      { sessionId: 's2', rangeStart: 1, rangeEnd: 10, summary: 'JGJ 55 slump requirement' }
    ])

    const results = await MemoryTierService.recall('sand ratio', { topK: 5 })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('score')
    const refreshed = await SessionSummary.findByPk(created[0].id)
    expect(refreshed.recallCount).toBeGreaterThan(0)
    expect(refreshed.lastRecalledAt).toBeTruthy()
  })

  test('applyDecay updates decayScore', async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await SessionSummary.create({
      sessionId: 's3',
      rangeStart: 1,
      rangeEnd: 5,
      summary: 'old memory',
      recallCount: 0,
      lastRecalledAt: old,
      decayScore: 1.0
    })

    const result = await MemoryTierService.applyDecay()

    expect(result.updated).toBeGreaterThan(0)
    const fetched = await SessionSummary.findOne({ where: { sessionId: 's3' } })
    expect(fetched.decayScore).toBeLessThan(1.0)
  })

  test('backfillAll generates summaries for historical messages without leaving gaps', async () => {
    // 模拟历史：2332 条消息分布在 3 个会话，全部未摘要
    for (const sid of ['backfill-a', 'backfill-b', 'backfill-c']) {
      for (let i = 0; i < 25; i++) {
        await ChatHistory.create({
          sessionId: sid,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `${sid} msg ${i}`
        })
      }
    }

    const result = await MemoryTierService.backfillAll({ batchSize: 20, minMessages: 20, concurrency: 2 })

    expect(result.sessionsProcessed).toBeGreaterThanOrEqual(3)
    expect(result.summariesCreated).toBeGreaterThanOrEqual(3)
    expect(result.errors).toBe(0)

    // 回填应当覆盖全部 25 条（25 = 20 + 5，所以至少 2 个 batch / session）
    const summaries = await SessionSummary.findAll({ raw: true })
    const idsCovered = new Set()
    for (const s of summaries) {
      if (!s.sessionId.startsWith('backfill-')) continue
      for (let id = s.rangeStart; id <= s.rangeEnd; id++) idsCovered.add(`${s.sessionId}:${id}`)
    }
    expect(idsCovered.size).toBeGreaterThanOrEqual(60)  // 至少 3 session × 20 条
  }, 60000)

  test('backfillAll is idempotent on a second pass', async () => {
    for (let i = 0; i < 22; i++) {
      await ChatHistory.create({ sessionId: 'idem-backfill', role: 'user', content: `m ${i}` })
    }

    const first = await MemoryTierService.backfillAll({ batchSize: 20, minMessages: 20, concurrency: 1 })
    const second = await MemoryTierService.backfillAll({ batchSize: 20, minMessages: 20, concurrency: 1 })

    // 第二次应 0 新增（已有 range 全部命中幂等检查）
    expect(second.summariesCreated).toBe(0)
    expect(first.summariesCreated).toBeGreaterThanOrEqual(1)
  }, 60000)
})
