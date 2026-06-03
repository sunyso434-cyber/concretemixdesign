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

  test('abort() 应触发 signal 让 strategy 终止（P1 修复）', async () => {
    const fakeStrategy = {
      execute: jest.fn().mockImplementation(async ({ signal }) => {
        // 模拟 strategy 等 signal
        await new Promise(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', resolve)
        })
        return { success: false, error: 'aborted' }
      })
    }
    const orch = new Orchestrator({
      deepseekService: {}, skillRegistry: {}, skillExecutor: {}, agentMemoryService: {}
    })
    orch.strategy = fakeStrategy

    // 异步触发 abort
    setTimeout(() => orch.abort(), 10)

    const result = await orch.run({ sessionId: 's', message: 'hi' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('aborted')
  })

  test('run() 应把 signal 和 getState 传给 strategy', async () => {
    const fakeStrategy = { execute: jest.fn().mockResolvedValue({ success: true, content: 'ok' }) }
    const orch = new Orchestrator({
      deepseekService: {},
      skillRegistry: {},
      skillExecutor: {},
      agentMemoryService: {}
    })
    orch.strategy = fakeStrategy

    await orch.run({ sessionId: 's1', message: 'hi' })

    const passedInput = fakeStrategy.execute.mock.calls[0][0]
    expect(passedInput.signal).toBeDefined()
    expect(typeof passedInput.signal.aborted).toBe('boolean')
    expect(typeof passedInput.getState).toBe('function')
    expect(passedInput.getState()).toBe('idle')  // run() 已结束，进入 finally 后是 idle
  })
})
