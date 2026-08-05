const { createAgentExecutor } = require('../agentExecutor')
jest.mock('../../services/AgentMemoryService', () => ({ saveMessage: jest.fn().mockResolvedValue({}) }))
jest.mock('../../db/services/SessionService', () => ({
  ensureSession: jest.fn().mockResolvedValue({ created: true, session: { sessionName: null } }),
}))

const makeExecutor = () => createAgentExecutor({
  getOrchestratorForSession: async () => ({ run: async () => ({ success: true }), deepseekService: null }),
  getOrchestrator: async () => null,
  agentMemorySvc: require('../../services/AgentMemoryService'),
  sessionSvc: require('../../db/services/SessionService'),
})

test('persistUserMessage=true：先 saveMessage 落库，再 fire-and-forget ensureSession', async () => {
  const ex = makeExecutor()
  await ex.runAgentSession({ sessionId: 's1', message: '你好', persistUserMessage: true, sink: { send() {} } })
  expect(require('../../services/AgentMemoryService').saveMessage).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 's1', role: 'user' }))
  await new Promise(r => setImmediate(r))
  expect(require('../../db/services/SessionService').ensureSession).toHaveBeenCalled()
})

test('persistUserMessage=false：不落库用户消息', async () => {
  const ex = makeExecutor()
  require('../../services/AgentMemoryService').saveMessage.mockClear()
  await ex.runAgentSession({ sessionId: 's1', message: 'hi', persistUserMessage: false, sink: { send() {} } })
  expect(require('../../services/AgentMemoryService').saveMessage).not.toHaveBeenCalled()
})

test('runAgentSession 捕获错误：用 classifyError 结构化 + 推 agent:progress error + requestId', async () => {
  const ex = createAgentExecutor({
    getOrchestratorForSession: async () => { throw Object.assign(new Error('boom'), { code: 'E-LLM-500', hint: 'h' }) },
    getOrchestrator: async () => null,
  })
  const events = []
  const r = await ex.runAgentSession({ sessionId: 's1', requestId: 'req1', message: 'x', persistUserMessage: false, sink: { send(c, p) { events.push([c, p]) } } })
  expect(r.success).toBe(false)
  expect(events.some(([c, p]) => c === 'agent:progress' && p.requestId === 'req1')).toBe(true)
})

test('confirm 无 sessionId 时走全局 orchestrator fallback', () => {
  let resolved = null
  const ex = createAgentExecutor({ getOrchestratorForSession: async () => null, getOrchestrator: async () => null })
  ex.setGlobalFallback({ resolveConfirmation: (c, a) => { resolved = [c, a] } })
  ex.confirm({ sessionId: undefined, confirmed: true, args: { answer: 'x' } })
  expect(resolved).toEqual([true, { answer: 'x' }])
})

describe('steerImmediate（v3.1）', () => {
  test('state===running → steer + requestInterrupt + cancelPendingConfirmation', () => {
    const orch = {
      state: 'running',
      steer: jest.fn(),
      requestInterrupt: jest.fn(),
      cancelPendingConfirmation: jest.fn()
    }
    const ex = createAgentExecutor({
      getOrchestratorForSession: async () => orch,
      getOrchestrator: async () => null,
    })
    // 直接通过 sessionAgents 注入（agentExecutor 内部 Map）
    ex.sessionAgents.set('s1', { orchestrator: orch })
    const r = ex.steerImmediate({ sessionId: 's1', msg: '立即改用 zod' })
    expect(r.success).toBe(true)
    expect(orch.steer).toHaveBeenCalledWith('立即改用 zod')
    expect(orch.requestInterrupt).toHaveBeenCalled()
    expect(orch.cancelPendingConfirmation).toHaveBeenCalled()
  })

  test('state 非 running → 返回失败不触发中断', () => {
    const orch = { state: 'idle', steer: jest.fn(), requestInterrupt: jest.fn(), cancelPendingConfirmation: jest.fn() }
    const ex = createAgentExecutor({ getOrchestratorForSession: async () => orch, getOrchestrator: async () => null })
    ex.sessionAgents.set('s1', { orchestrator: orch })
    const r = ex.steerImmediate({ sessionId: 's1', msg: 'x' })
    expect(r.success).toBe(false)
    expect(orch.requestInterrupt).not.toHaveBeenCalled()
  })

  test('agent 未运行 → 返回失败', () => {
    const ex = createAgentExecutor({ getOrchestratorForSession: async () => null, getOrchestrator: async () => null })
    const r = ex.steerImmediate({ sessionId: 's1', msg: 'x' })
    expect(r.success).toBe(false)
  })
})
