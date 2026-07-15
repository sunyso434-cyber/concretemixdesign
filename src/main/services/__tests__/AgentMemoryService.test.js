// 隔离 EventBus 单例 + 注入 mock agentMd
jest.mock('../../agent/agentMd', () => {
  return {
    getInstance: () => ({
      getCached: () => ({
        raw: '',
        parsed: {
          version: 2,
          replyStyle: {},
          workflow: [],
          customKnowledge: [],
          ignoredSuggestionTypes: [],
          unknownSections: {}
        }
      }),
      getFormattedRules: () => ''
    })
  }
})

// stub 掉 db 里的 count/findAll 避免连真实 SQLite
jest.mock('../../db/database', () => {
  const actual = jest.requireActual('../../db/database')
  return {
    ...actual,
    MixDesign: { count: async () => 0, findAll: async () => [] },
    OptimizationHistory: { count: async () => 0 }
  }
})

const AgentMemoryService = require('../AgentMemoryService')
const { CorrectionRule, sequelize } = require('../../db/database')

beforeAll(async () => {
  await sequelize.sync()
})

afterAll(async () => {
  await sequelize.close()
})

describe('AgentMemoryService.getResourceSummary v2', () => {
  test('返回新结构（含 userRulesSummary，无 userPreferences）', async () => {
    const summary = await AgentMemoryService.getResourceSummary()

    expect(summary).toHaveProperty('designHistoryCount')
    expect(summary).toHaveProperty('optimizationCount')
    expect(summary).toHaveProperty('userRulesSummary')
    // v1 老字段不应存在
    expect(summary.userPreferences).toBeUndefined()
    // v1 老字段 preferenceSummary 也不应存在
    expect(summary.preferenceSummary).toBeUndefined()
  })

  test('无常用强度时 userRulesSummary 应为空字符串', async () => {
    const summary = await AgentMemoryService.getResourceSummary()
    expect(summary.userRulesSummary).toBe('')
  })

  test('有常用强度时 userRulesSummary 应包含"常用强度"前缀', async () => {
    // 重新 mock 让 MixDesign.findAll 返回强度数据
    const { MixDesign } = require('../../db/database')
    MixDesign.findAll = async () => [
      { strength: 'C30', cnt: 10 },
      { strength: 'C40', cnt: 5 }
    ]

    const summary = await AgentMemoryService.getResourceSummary()
    expect(summary.userRulesSummary).toContain('常用强度')
    expect(summary.userRulesSummary).toContain('C30')
    expect(summary.userRulesSummary).toContain('C40')
  })

  test('getResourceSummary 不再调用 agentMdService（v2 无 professionalPrefs）', () => {
    // 确认 _formatPreferenceSummary 已删（v2 改造完成）
    expect(typeof AgentMemoryService._formatPreferenceSummary).toBe('undefined')
  })
})

describe('AgentMemoryService.findSimilarCorrections v2 (BM25)', () => {
  const testRules = [
    { context: '设计 C30 混凝土配合比', originalSuggestion: 'P.O42.5 水泥', userCorrection: 'P.O52.5 水泥', toolName: 'calculate_mix_design' },
    { context: '砂率偏低需要调整', originalSuggestion: '0.32', userCorrection: '0.36', toolName: 'calculate_mix_design' },
    { context: '坍落度太大', originalSuggestion: '180mm', userCorrection: '120mm', toolName: 'calculate_mix_design' }
  ]

  beforeAll(async () => {
    // 清理 + 插入测试数据
    await CorrectionRule.destroy({ truncate: true })
    for (const r of testRules) {
      await CorrectionRule.create(r)
    }
  })

  afterAll(async () => {
    await CorrectionRule.destroy({ truncate: true })
  })

  test('走 BM25 检索应返回命中记录', async () => {
    // 查询 C30 应命中规则 1（设计 C30 混凝土配合比）；查询 坍落度 应命中规则 3（坍落度太大）
    const results = await AgentMemoryService.findSimilarCorrections(
      '坍落度太大怎么调',
      null,
      2
    )
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('score')
    expect(results[0]).toHaveProperty('context')
    expect(results[0]).toHaveProperty('originalSuggestion')
    expect(results[0]).toHaveProperty('userCorrection')
    // 第一条应是坍落度相关（score 最高）
    expect(results[0].context).toContain('坍落度')
  })

  test('空规则时返回空数组', async () => {
    await CorrectionRule.destroy({ truncate: true })
    const results = await AgentMemoryService.findSimilarCorrections({}, null, 3)
    expect(results).toEqual([])
  })
})

describe('AgentMemoryService.saveMessage schema 校验', () => {
  // singleton 直接引用，调 saveMessage 会写真实 SQLite
  test('tool 消息无 toolCallId 时拒绝', async () => {
    await expect(
      AgentMemoryService.saveMessage({
        sessionId: 'test-session',
        role: 'tool',
        content: '{}',
        toolCallId: null
      })
    ).rejects.toThrow(/toolCallId/)
  })

  test('user 消息不需要 toolCallId', async () => {
    await expect(
      AgentMemoryService.saveMessage({
        sessionId: 'test-session',
        role: 'user',
        content: '你好'
      })
    ).resolves.toBeDefined()
  })

  test('assistant 消息必须至少有 content 或 toolCalls', async () => {
    await expect(
      AgentMemoryService.saveMessage({
        sessionId: 'test-session',
        role: 'assistant',
        content: null,
        toolCalls: null
      })
    ).rejects.toThrow(/content 或 toolCalls/)
  })

  test('sessionId 或 role 缺失时拒绝', async () => {
    await expect(
      AgentMemoryService.saveMessage({
        role: 'user',
        content: '你好'
      })
    ).rejects.toThrow(/sessionId/)
  })
})
