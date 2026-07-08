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

  test('不传 softSkillInjector 时向后兼容', async () => {
    const strategyNoInjector = new UnifiedStrategy({
      deepseekService: { chat: jest.fn().mockResolvedValue({ content: 'ok' }) },
      skillRegistry: { getToolSchemas: jest.fn(() => []), getSkillMeta: jest.fn(() => null), getSkill: jest.fn() },
      skillExecutor: { execute: jest.fn() },
      agentMemoryService: { saveMessage: jest.fn().mockResolvedValue(), buildHistoryMessages: jest.fn().mockResolvedValue([]) },
      systemService: null,
      orchestrator: null
      // softSkillInjector OMITTED
    })
    // 应不报错
    await expect(strategyNoInjector.execute({ sessionId: 's1', message: 'hi', webContents: null }))
      .resolves.toBeDefined()
  })
})
