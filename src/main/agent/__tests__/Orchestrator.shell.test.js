const Orchestrator = require('../Orchestrator')

describe('Orchestrator 外壳', () => {
  test('create("unified") 应返回实例', () => {
    const orch = Orchestrator.create('unified', {
      deepseekService: {},
      skillRegistry: {},
      skillExecutor: {},
      agentMemoryService: {}
    })
    expect(orch).toBeInstanceOf(Orchestrator)
    expect(orch.state).toBe('idle')
  })

  test('create("multi-agent") 应返回实例（80 行委托版）', () => {
    const orch = Orchestrator.create('multi-agent', {
      deepseekService: {},
      skillRegistry: {},
      skillExecutor: {},
      agentMemoryService: {}
    })
    expect(orch).toBeInstanceOf(Orchestrator)
  })

  test('create 未知 strategy 应 throw', () => {
    expect(() => Orchestrator.create('unknown', {})).toThrow(/strategy/i)
  })

  test('run() 应委托给 strategy.execute()', async () => {
    const fakeStrategy = { execute: jest.fn().mockResolvedValue({ success: true, content: 'ok' }) }
    const orch = new Orchestrator({
      deepseekService: {},
      skillRegistry: {},
      skillExecutor: {},
      agentMemoryService: {}
    })
    orch.strategy = fakeStrategy

    const result = await orch.run({ sessionId: 's1', message: 'hi' })
    expect(fakeStrategy.execute).toHaveBeenCalled()
    expect(result.success).toBe(true)
  })
})
