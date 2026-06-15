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
    BasicMixDesign: { count: async () => 0 },
    OptimizationHistory: { count: async () => 0 }
  }
})

// stub StandardKnowledgeService.listStandards 避免引入 electron.app
jest.mock('../services/StandardKnowledgeService', () => ({
  listStandards: async () => []
}))

const AgentMemoryService = require('../services/AgentMemoryService')

describe('AgentMemoryService.getResourceSummary 偏好注入', () => {
  test('应从 agent.md 读取偏好并生成中文摘要', async () => {
    const result = await AgentMemoryService.getResourceSummary()
    // 不再依赖 UserPreference 表（删表零风险）
    expect(result.userPreferences).toBeDefined()
    // 中文摘要应包含 "拉法基" + "粉煤灰" + "锂渣" + "体积法"
    const blob = JSON.stringify(result)
    expect(blob).toContain('拉法基')
    expect(blob).toContain('粉煤灰')
    expect(blob).toContain('锂渣')
    expect(blob).toContain('体积法')
  })

  test('应保留 commonStrengthGrades（资源统计不是偏好）', async () => {
    const result = await AgentMemoryService.getResourceSummary()
    expect(Array.isArray(result.userPreferences.commonStrengthGrades)).toBe(true)
  })
})