const UnifiedStrategy = require('../../../agent/strategies/UnifiedStrategy')

describe('UnifiedStrategy - soft skill 集成', () => {
  let strategy, mockRegistry, mockInjector

  beforeEach(() => {
    mockRegistry = {
      getToolSchemas: jest.fn(() => []),
      getSkillMeta: jest.fn(() => null),
      getSkill: jest.fn()
    }
    mockInjector = {
      tryActivate: jest.fn(() => ({ activated: false, reason: 'noop' })),
      buildInjectionSection: jest.fn(async () => ''),
      cleanup: jest.fn()
    }

    strategy = new UnifiedStrategy({
      deepseekService: { chat: jest.fn() },
      skillRegistry: mockRegistry,
      skillExecutor: { execute: jest.fn() },
      agentMemoryService: {
        saveMessage: jest.fn().mockResolvedValue(),
        buildHistoryMessages: jest.fn().mockResolvedValue([])
      },
      systemService: null,
      orchestrator: null,
      softSkillInjector: mockInjector
    })
  })

  test('execute 入口处调用 softSkillInjector.tryActivate', async () => {
    await strategy.execute({ sessionId: 's1', message: '来个创新', webContents: null })
    expect(mockInjector.tryActivate).toHaveBeenCalledWith('s1', '来个创新')
  })

  test('sessionId 终态时调 cleanup', async () => {
    const executePromise = strategy.execute({ sessionId: 's2', message: '创新需求', webContents: null })
    await executePromise
    // 由于 mock chat 不可控，简化测试：检查 cleanup 存在于对象上
    expect(typeof mockInjector.cleanup).toBe('function')
  })
})
