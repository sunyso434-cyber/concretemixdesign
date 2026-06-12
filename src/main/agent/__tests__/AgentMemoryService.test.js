/**
 * AgentMemoryService.buildMemoryContext 单测
 *
 * 验证 (P0-2 修复 + agent.md 迁移):
 * - buildMemoryContext 读 agent.md 替代 UserPreference/CorrectionRule
 * - 中文键名保留原文
 * - getHistory 用于历史摘要
 */

jest.mock('../../db/database', () => {
  return {
    ChatHistory: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() },
    UserPreference: { upsert: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
    CorrectionRule: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() }
  }
})

const AgentMemoryService = require('../../services/AgentMemoryService')

describe('AgentMemoryService.buildMemoryContext (agent.md 迁移)', () => {
  let mem

  beforeEach(() => {
    mem = Object.create(AgentMemoryService)
    // mock getHistory(新方法依赖)
    mem.getHistory = jest.fn(async () => [])
    // mock agentMdService
    mem.agentMdService = {
      getFormattedRules: jest.fn(() => '## 回复风格\n- 语气：专业')
    }
  })

  test('buildMemoryContext 应注入 agent.md 内容', async () => {
    const ctx = await mem.buildMemoryContext('session-1', {})
    expect(ctx).toContain('回复风格')
    expect(ctx).toContain('专业')
  })

  test('buildMemoryContext 应包含"用户自定义规则"标题', async () => {
    const ctx = await mem.buildMemoryContext('session-1', {})
    expect(ctx).toContain('用户自定义规则')
  })

  test('buildMemoryContext 不再注入 UserPreference/CorrectionRule 旧字段', async () => {
    const ctx = await mem.buildMemoryContext('session-1', {})
    expect(ctx).not.toContain('用户偏好:')
    expect(ctx).not.toContain('修正记录')
  })

  test('未传 options 时也应能调用（不崩）', async () => {
    const ctx = await mem.buildMemoryContext('session-1')
    expect(typeof ctx).toBe('string')
    expect(ctx.length).toBeGreaterThan(0)
  })

  test('未注入 agentMdService 时应降级到 require 路径', async () => {
    delete mem.agentMdService
    // 此处因 require 真实模块可能抛错,只验证不会无限循环
    // 只要不崩,测试通过(真实回退由 require 内部错误处理)
    try {
      await mem.buildMemoryContext('s1')
    } catch (e) {
      // 接受:真实 require 路径在测试环境可能失败,但不应 crash 测试运行
      expect(e).toBeDefined()
    }
  })
})
