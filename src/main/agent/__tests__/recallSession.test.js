/**
 * recallSession skill 测试
 * 覆盖：
 * - 空 query 直接返回错误
 * - 摘要召回走 MemoryTierService.recall
 * - 原文召回走 chat_history_fts（或 LIKE 兜底）
 * - P1：失败教训（LearningService.findFailurePatterns）被调用并返回
 * - P1：修正记录（AgentMemoryService.findSimilarCorrections）被调用并返回
 * - 各子调用失败不阻断主流程
 */

jest.mock('../../db/database', () => {
  // FTS 调用抛错触发兜底；LIKE 返回空数组
  const mockQuery = jest.fn().mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('chat_history_fts')) {
      return Promise.reject(new Error('chat_history_fts missing'))
    }
    return Promise.resolve([])
  })
  return {
    ChatHistory: { findAll: jest.fn().mockResolvedValue([]) },
    sequelize: { query: mockQuery, QueryTypes: { SELECT: 'SELECT' } }
  }
})

jest.mock('../../services/LearningService', () => ({
  findFailurePatterns: jest.fn().mockResolvedValue([
    { context: '{"skillName":"x"}', userCorrection: '[自动记录] failed', score: 0.9 }
  ])
}))

jest.mock('../../services/AgentMemoryService', () => ({
  findSimilarCorrections: jest.fn().mockResolvedValue([
    { context: 'old context', originalSuggestion: { v: 1 }, userCorrection: { v: 2 }, score: 0.8 }
  ])
}))

const recallSessionModule = require('../skills/recallSession')
const LearningService = require('../../services/LearningService')
const AgentMemoryService = require('../../services/AgentMemoryService')
const MemoryTierService = require('../../services/MemoryTierService')

beforeEach(() => {
  jest.clearAllMocks()
})

describe('recallSession skill', () => {
  test('空 query 返回 success=false 不查 DB', async () => {
    const result = await recallSessionModule.execute({ query: '' })

    expect(result.success).toBe(false)
    expect(result.summaries).toEqual([])
    expect(result.rawMessages).toEqual([])
    expect(result.failures).toEqual([])
    expect(result.corrections).toEqual([])
  })

  test('空 query（仅空格）也直接返回错误', async () => {
    const result = await recallSessionModule.execute({ query: '   ' })
    expect(result.success).toBe(false)
  })

  test('正常 query 返回 summaries + rawMessages + failures + corrections', async () => {
    // stub MemoryTierService.recall
    const originalRecall = MemoryTierService.recall
    MemoryTierService.recall = jest.fn().mockResolvedValue([
      { sessionId: 's1', summary: 'sand ratio 36%', keyDecisions: ['use 36%'], score: 0.95 }
    ])

    try {
      const result = await recallSessionModule.execute({ query: 'sand ratio', topK: 5, toolName: 'calculate_mix_design' })

      expect(result.success).toBe(true)
      expect(result.summaries).toHaveLength(1)
      expect(result.summaries[0].sessionId).toBe('s1')

      // P1：失败教训和修正记录被调用
      expect(LearningService.findFailurePatterns).toHaveBeenCalledWith('calculate_mix_design', 'sand ratio')
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].userCorrection).toContain('failed')

      expect(AgentMemoryService.findSimilarCorrections).toHaveBeenCalledWith('sand ratio', 'calculate_mix_design', 3)
      expect(result.corrections).toHaveLength(1)
      expect(result.corrections[0].score).toBe(0.8)
    } finally {
      MemoryTierService.recall = originalRecall
    }
  })

  test('toolName 为空时 findFailurePatterns 仍被调用（用空串）', async () => {
    const originalRecall = MemoryTierService.recall
    MemoryTierService.recall = jest.fn().mockResolvedValue([])

    try {
      await recallSessionModule.execute({ query: 'foo' })

      // 没有 toolName → findFailurePatterns 第一参数为 ''
      expect(LearningService.findFailurePatterns).toHaveBeenCalledWith('', 'foo')
      // findSimilarCorrections 第二参数为 null
      expect(AgentMemoryService.findSimilarCorrections).toHaveBeenCalledWith('foo', null, 3)
    } finally {
      MemoryTierService.recall = originalRecall
    }
  })

  test('failures 子调用失败不影响主流程', async () => {
    LearningService.findFailurePatterns.mockRejectedValueOnce(new Error('boom'))

    const originalRecall = MemoryTierService.recall
    MemoryTierService.recall = jest.fn().mockResolvedValue([])

    try {
      const result = await recallSessionModule.execute({ query: 'foo' })

      expect(result.success).toBe(true)
      expect(result.failures).toEqual([])  // 失败 → 空数组
      expect(result.corrections).toHaveLength(1)  // corrections 仍返回
    } finally {
      MemoryTierService.recall = originalRecall
    }
  })

  test('corrections 子调用失败不影响主流程', async () => {
    AgentMemoryService.findSimilarCorrections.mockRejectedValueOnce(new Error('boom'))

    const originalRecall = MemoryTierService.recall
    MemoryTierService.recall = jest.fn().mockResolvedValue([])

    try {
      const result = await recallSessionModule.execute({ query: 'foo' })

      expect(result.success).toBe(true)
      expect(result.corrections).toEqual([])
      expect(result.failures).toHaveLength(1)  // failures 仍返回
    } finally {
      MemoryTierService.recall = originalRecall
    }
  })

  test('导出正确的参数 schema', () => {
    expect(recallSessionModule.name).toBe('recall_session')
    expect(recallSessionModule.category).toBe('记忆')
    expect(recallSessionModule.parameters.query.required).toBe(true)
    expect(recallSessionModule.parameters.query.type).toBe('string')
    expect(recallSessionModule.parameters.topK.default).toBe(5)
    expect(recallSessionModule.parameters.toolName).toBeDefined()
  })
})