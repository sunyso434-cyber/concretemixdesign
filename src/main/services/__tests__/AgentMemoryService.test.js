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
    BasicMixDesign: { count: async () => 0 },
    OptimizationHistory: { count: async () => 0 }
  }
})

const AgentMemoryService = require('../AgentMemoryService')

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
