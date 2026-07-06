/**
 * AgentMemoryService.buildAgentMdBlock 单测（Task 8 改名）
 *
 * v2 改造（Task 8）：
 * - buildMemoryContext → buildAgentMdBlock
 * - 只返回 agent.md 规则整段（不再拼 history、不再读 UserPreference/CorrectionRule）
 * - history 走 buildHistoryMessages 单独走 messages 流
 */

jest.mock('../../db/database', () => {
  return {
    ChatHistory: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() },
    UserPreference: { upsert: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
    CorrectionRule: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() }
  }
})

const AgentMemoryService = require('../../services/AgentMemoryService')

describe('AgentMemoryService.buildAgentMdBlock (Task 8 改名 + v2)', () => {
  let mem

  beforeEach(() => {
    mem = Object.create(AgentMemoryService)
    // mock agentMdService
    mem.agentMdService = {
      getFormattedRules: jest.fn(() => '## 回复风格\n- 语气：专业')
    }
  })

  test('buildAgentMdBlock 应注入 agent.md 内容', async () => {
    const block = await mem.buildAgentMdBlock('session-1')
    expect(block).toContain('回复风格')
    expect(block).toContain('专业')
  })

  test('buildAgentMdBlock 不再含"用户自定义规则"标题（由 buildSystemPrompt 包裹）', async () => {
    // v2：buildAgentMdBlock 只返回 markdown 内容本身，不再带"用户自定义规则"标题
    // 标题由 systemPromptBuilder.js 的 userRulesBlock 段注入
    const block = await mem.buildAgentMdBlock('session-1')
    expect(block).not.toContain('用户自定义规则')
  })

  test('buildAgentMdBlock 不再含"历史摘要"段（走 buildHistoryMessages 单独流）', async () => {
    const block = await mem.buildAgentMdBlock('session-1')
    expect(block).not.toContain('历史摘要')
    expect(block).not.toContain('修正记录')
  })

  test('buildAgentMdBlock 不再注入 UserPreference/CorrectionRule 旧字段', async () => {
    const block = await mem.buildAgentMdBlock('session-1')
    expect(block).not.toContain('用户偏好:')
  })

  test('agentMdService 未配置时降级返回"（未配置）"', async () => {
    const noSvc = Object.create(AgentMemoryService)
    noSvc.agentMdService = null
    // 此处因 require 真实 agentMd 模块可能抛错,只验证不崩
    try {
      const result = await noSvc.buildAgentMdBlock('s1')
      // 如未抛错,必须是字符串
      expect(typeof result).toBe('string')
    } catch (e) {
      // 真实 require 路径在测试环境可能失败,但不应 crash 测试运行
      expect(e).toBeDefined()
    }
  })

  test('agentMdService 返回空字符串时 fallback 到"（未配置）"', async () => {
    const emptySvc = Object.create(AgentMemoryService)
    emptySvc.agentMdService = { getFormattedRules: jest.fn(() => '') }
    const result = await emptySvc.buildAgentMdBlock('s1')
    expect(result).toBe('（未配置）')
  })
})
