const MemoryTierService = require('../MemoryTierService')
const { SessionSummary } = require('../../db/database')
const { ChatHistory } = require('../../db/database')

// ponytail: 测试环境无 LLM 密钥，直接把 stub 注入到单例实例上
const STUB_LLM = { chat: async () => ({ content: '{"summary":"测试摘要","keyDecisions":[],"toolCalls":[]}', tool_calls: null, role: 'assistant' }) }
beforeEach(() => {
  MemoryTierService.deepseekService = STUB_LLM
})
afterAll(() => {
  // ponytail: 还原真实 LLM，避免影响其他测试
  delete MemoryTierService.deepseekService
})

describe('MemoryTierService', () => {
  afterEach(async () => {
    await SessionSummary.destroy({ truncate: true })
    await ChatHistory.destroy({ where: { sessionId: 'test-sess' } })
  })

  test('summarizeOldMessages 调用 LLM 摘要并写入 SessionSummary', async () => {
    // 准备 21 条消息（用真实插入 ID 范围，避免 sqlite 自增不是从 1 开始）
    const ids = []
    for (let i = 0; i < 21; i++) {
      const m = await ChatHistory.create({
        sessionId: 'test-sess',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `消息 ${i}`
      })
      ids.push(m.id)
    }
    const rangeStart = ids[0]
    const rangeEnd = ids[ids.length - 1]

    const svc = MemoryTierService
    const result = await svc.summarizeOldMessages('test-sess', { rangeStart, rangeEnd })

    expect(result).toHaveProperty('id')
    const fetched = await SessionSummary.findByPk(result.id)
    expect(fetched.sessionId).toBe('test-sess')
    expect(fetched.rangeStart).toBe(rangeStart)
    expect(fetched.rangeEnd).toBe(rangeEnd)
  }, 30000)

  test('recall 走 FTS5 + BM25 混合排序', async () => {
    await SessionSummary.bulkCreate([
      { sessionId: 's1', rangeStart: 1, rangeEnd: 10, summary: '讨论砂率 36% 的取值依据' },
      { sessionId: 's2', rangeStart: 1, rangeEnd: 10, summary: 'JGJ 55 标准里坍落度的规定' }
    ])

    const svc = MemoryTierService
    const results = await svc.recall('砂率', { topK: 5 })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('score')
  })

  test('applyDecay 按幂律公式更新 decayScore', async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 天前
    await SessionSummary.create({
      sessionId: 's3', rangeStart: 1, rangeEnd: 5, summary: '老记忆',
      recallCount: 0, lastRecalledAt: old, decayScore: 1.0
    })

    const svc = MemoryTierService
    const result = await svc.applyDecay()

    expect(result.updated).toBeGreaterThan(0)
    const fetched = await SessionSummary.findOne({ where: { sessionId: 's3' } })
    // 10 天没召回，decay 应该降到 0.5 左右（1 / (1 + 10*0.1) = 0.5）
    expect(fetched.decayScore).toBeLessThan(1.0)
  })
})