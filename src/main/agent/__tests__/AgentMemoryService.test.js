/**
 * AgentMemoryService.buildMemoryContext 单测
 *
 * 验证 P0-2 修复：buildMemoryContext 必须把 options.queryContext 透传给
 * findSimilarCorrections，否则 TF-IDF 召回永远拿空 queryContext，所有规则
 * 的 score 都是 0，修正记录永远召不回。
 *
 * 关键点：
 * - mock findSimilarCorrections 验证它接到了 options.queryContext
 * - saveCorrection 用实际字段 originalSuggestion/userCorrection/toolName
 */

jest.mock('../../db/database', () => {
  // 提供 ChatHistory / UserPreference / CorrectionRule 的最小 mock
  // 目的：buildMemoryContext 只用到 getAllPreferences + findSimilarCorrections，
  // 其它 save* 方法在本测试中不被调用，故只做占位
  return {
    ChatHistory: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() },
    UserPreference: { upsert: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
    CorrectionRule: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() }
  }
})

const AgentMemoryService = require('../../services/AgentMemoryService')

describe('AgentMemoryService.buildMemoryContext (P0-2 TF-IDF 召回)', () => {
  let mem

  beforeEach(() => {
    mem = Object.create(AgentMemoryService)
    // mock 数据库层
    mem.getAllPreferences = jest.fn(async () => ({}))
    mem.findSimilarCorrections = jest.fn(async () => [])
  })

  test('应把 options.queryContext 透传给 findSimilarCorrections', async () => {
    const queryContext = { lastUserMessage: 'C30 配比', strength: 'C30' }

    await mem.buildMemoryContext('s1', { queryContext })

    // 关键断言：findSimilarCorrections 第一个参数必须是 queryContext，不能是 {}
    expect(mem.findSimilarCorrections).toHaveBeenCalledTimes(1)
    const firstArg = mem.findSimilarCorrections.mock.calls[0][0]
    expect(firstArg).toBe(queryContext)
    expect(firstArg).toEqual({ lastUserMessage: 'C30 配比', strength: 'C30' })
  })

  test('未传 queryContext 时也应能调用（不崩）', async () => {
    await mem.buildMemoryContext('s1')
    expect(mem.findSimilarCorrections).toHaveBeenCalledTimes(1)
  })
})
