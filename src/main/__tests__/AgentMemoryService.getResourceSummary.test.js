// 隔离 EventBus 单例 + 注入 mock agentMd
jest.mock('../agent/agentMd', () => {
  return {
    getInstance: () => ({
      getCached: () => ({
        raw: '',
        parsed: {
          version: 2,
          replyStyle: {},
          professionalPrefs: {
            materials: [
              { category: '水泥', dimension: '厂家', value: '拉法基' },
              { category: '掺合料', dimension: '种类', values: ['粉煤灰', '锂渣'] }
            ],
            method: '体积法'
          },
          workflow: [],
          customKnowledge: [],
          ignoredSuggestionTypes: ['material_performance'],
          unknownSections: {}
        }
      }),
      getFormattedRules: () => ''
    })
  }
})

// stub 掉 db 里的 count/findAll 避免连真实 SQLite
jest.mock('../db/database', () => {
  const actual = jest.requireActual('../db/database')
  return {
    ...actual,
    MixDesign: { count: async () => 0, findAll: async () => [] },
    OptimizationHistory: { count: async () => 0 }
  }
})

const AgentMemoryService = require('../services/AgentMemoryService')
const { MixDesign } = require('../db/database')

describe('AgentMemoryService.getResourceSummary 偏好注入', () => {
  beforeEach(() => {
    MixDesign.findAll = jest.fn(async () => [])
  })

  test('不再把 agent.md 专业偏好注入资源摘要', async () => {
    const result = await AgentMemoryService.getResourceSummary()
    expect(result.userPreferences).toBeUndefined()
    const blob = JSON.stringify(result)
    expect(blob).not.toContain('拉法基')
    expect(blob).not.toContain('体积法')
  })

  test('常用强度通过 userRulesSummary 保留', async () => {
    MixDesign.findAll = jest.fn(async () => [
      { strength: 'C30' },
      { strength: 'C40' }
    ])
    const result = await AgentMemoryService.getResourceSummary()
    expect(result.userRulesSummary).toContain('C30')
    expect(result.userRulesSummary).toContain('C40')
  })
})
