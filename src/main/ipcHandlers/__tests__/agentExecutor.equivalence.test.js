/**
 * M0-2：agentHandler 接入共享执行模块（agentExecutor）行为等价测试
 *
 * 覆盖现有测试未覆盖的路径：
 * - agent:run 成功/失败（失败断言 classifyError 结构化 code/title/hint + requestId，M0-1 评审补强点）
 * - agent:run 的 sink 双角色（.send 事件发射 + Orchestrator 收到的 webContents 就是 event.sender）
 * - agent:saveMessage user 分支：saveMessage 落库 + fire-and-forget ensureSession
 * - agent:confirm 无 sessionId 走全局 fallback（executor.setGlobalFallback 同步）
 * - agent:archiveSession 的 isRunning 语义（走 executor.isSessionRunning）
 *
 * 跑法：npx jest src/main/ipcHandlers/__tests__/agentExecutor.equivalence.test.js
 *
 * 注：本机原生 sqlite3 addon ABI 损坏（node -e "require('sqlite3')" 即段错误），
 * 因此所有触达 db/database / 真实数据库的模块都必须 mock，绝不加载真实 sqlite3。
 */

const { ipcMain } = require('electron')

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
  shell: { openPath: jest.fn() },
  BrowserWindow: jest.fn()
}))

jest.mock('../../utils/logRotator', () => ({ rotateIfNeeded: jest.fn() }))
jest.mock('../../services/DeepSeekService', () => {
  const fn = jest.fn()
  fn.setSkillRegistry = jest.fn()
  fn.setSkillExecutor = jest.fn()
  fn.getSkillExecutor = jest.fn()
  return fn
})
jest.mock('../../agent/Orchestrator', () => ({ create: jest.fn() }))
jest.mock('../../agent/SkillRegistry', () => jest.fn().mockImplementation(() => ({
  discover: jest.fn().mockResolvedValue(),
  register: jest.fn(),
  size: 0,
  skillNames: [],
  _skills: new Map(),
  getUserDir: jest.fn(),
  has: jest.fn(() => false)
})))
jest.mock('../../agent/SkillExecutor', () => jest.fn().mockImplementation(() => ({ listSkills: jest.fn() })))
jest.mock('../../agent/DynamicContextProvider', () => jest.fn().mockImplementation(() => ({ setRegistry: jest.fn() })))
jest.mock('../../agent/SkillDebugger', () => jest.fn())
jest.mock('../../agent/workspaceTools', () => ({ buildWorkspaceSkills: jest.fn(() => []) }))
jest.mock('../../services/AgentMemoryService', () => ({
  saveMessage: jest.fn().mockResolvedValue({}),
  deleteSession: jest.fn().mockResolvedValue({}),
  getHistory: jest.fn().mockResolvedValue([]),
  duplicateSession: jest.fn().mockResolvedValue({}),
}))
jest.mock('../../services/SystemService', () => ({
  getActiveLlmConfig: jest.fn().mockResolvedValue({ id: 1, apiKey: 'sk-test' })
}))
jest.mock('../../db/services/SessionService', () => ({
  ensureSession: jest.fn().mockResolvedValue({ created: true, session: { sessionName: null } }),
  discardSessionIfEmpty: jest.fn().mockResolvedValue({}),
  listRecentSessionsWithMeta: jest.fn().mockResolvedValue([]),
}))
jest.mock('../archiveSessionCore', () => ({ applyArchive: jest.fn() }))
jest.mock('../../agent/agentMd', () => ({ getInstance: jest.fn() }))
jest.mock('../../agent/agentMd/AgentMdParser', () => ({ AgentMdParser: { formatToMarkdown: jest.fn(), parse: jest.fn() } }))
jest.mock('../../agent/preferences', () => ({ getSuggestionStore: jest.fn() }))
jest.mock('../../services/LearningService', () => ({ init: jest.fn(), getSuggestions: jest.fn() }))
jest.mock('../../db/database', () => ({}))

// errorClassifier 故意不 mock：用真实 classifyError，让错误事件的 code/title/hint 来自真实分类器
const Orchestrator = require('../../agent/Orchestrator')
const AgentMemoryService = require('../../services/AgentMemoryService')
const SessionService = require('../../db/services/SessionService')
const { applyArchive } = require('../archiveSessionCore')

const { registerAgentHandlers, getExecutor } = require('../agentHandler')

function makeMockOrchestrator() {
  return {
    run: jest.fn().mockResolvedValue({ success: true, content: 'ok' }),
    deepseekService: { invoke: jest.fn().mockResolvedValue('AI 标题') },
    resolveConfirmation: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    abort: jest.fn(),
  }
}

function getHandler(channel) {
  const calls = ipcMain.handle.mock.calls.filter(c => c[0] === channel)
  return calls[calls.length - 1][1]
}

let mockOrchestrator

beforeEach(() => {
  jest.clearAllMocks()
  mockOrchestrator = makeMockOrchestrator()
  Orchestrator.create.mockReturnValue(mockOrchestrator)
  // 清空 executor 会话锁状态（模块单例跨用例）
  getExecutor().sessionAgents.clear()
  ipcMain.handle.mockClear()
  registerAgentHandlers()
})

describe('agent:run 行为等价（走 executor.runAgentSession，sink 双角色）', () => {
  test('成功：返回 {success:true, result}，Orchestrator.run 收到 event.sender 作为 webContents', async () => {
    const run = getHandler('agent:run')
    const sender = { send: jest.fn(), isDestroyed: () => false }
    const r = await run({ sender }, { sessionId: 's1', message: '设计C30', mode: 'auto', attachments: [] })
    expect(r).toEqual({ success: true, result: { success: true, content: 'ok' } })
    expect(mockOrchestrator.run).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1',
      message: '设计C30',
      mode: 'auto',
      attachments: [],
      webContents: sender, // sink 双角色：传给 Orchestrator 的就是 event.sender
    }))
  })

  test('失败：classifyError 结构化 code/title/hint，agent:progress error 事件含 requestId', async () => {
    const run = getHandler('agent:run')
    mockOrchestrator.run.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'E-LLM-500', hint: 'DeepSeek 服务异常' })
    )
    const events = []
    const sender = { send: (ch, p) => events.push([ch, p]), isDestroyed: () => false }
    const r = await run({ sender }, { sessionId: 's1', requestId: 'req-123', message: 'hi' })

    expect(r.success).toBe(false)
    // 返回值里的 error 是 classifyError 结构化输出（不止 requestId）
    expect(r.error.code).toBe('E-LLM-500')
    expect(r.error.title).toBe('AI 服务端错误')
    expect(r.error.hint).toContain('DeepSeek 服务异常')
    expect(r.error.recovery).toBeTruthy()

    // 错误事件（agent:progress type:error）带结构化 error + requestId
    const ev = events.find(([ch]) => ch === 'agent:progress')
    expect(ev).toBeTruthy()
    expect(ev[1]).toMatchObject({
      type: 'error',
      sessionId: 's1',
      requestId: 'req-123',
    })
    expect(ev[1].error.code).toBe('E-LLM-500')
    expect(ev[1].error.title).toBe('AI 服务端错误')
    expect(ev[1].error.hint).toContain('DeepSeek 服务异常')
  })

  test('无 API key：返回 {success:false, error:"DeepSeek API未配置..."}', async () => {
    require('../../services/SystemService').getActiveLlmConfig.mockResolvedValueOnce(null)
    const run = getHandler('agent:run')
    const r = await run({ sender: { send: jest.fn() } }, { sessionId: 's1', message: 'hi' })
    expect(r).toEqual({ success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' })
  })
})

describe('agent:saveMessage 行为等价（走 executor.saveUserMessage）', () => {
  test('user 分支：先 saveMessage 落库，再 fire-and-forget ensureSession（首条消息建会话 + AI 标题）', async () => {
    const save = getHandler('agent:saveMessage')
    const sender = { send: jest.fn(), isDestroyed: () => false }
    const r = await save({ sender }, { sessionId: 's1', role: 'user', content: '帮我设计C30', metadata: {}, stopReason: null })
    expect(r).toEqual({ success: true })
    expect(AgentMemoryService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', role: 'user', content: '帮我设计C30', stopReason: null })
    )
    // fire-and-forget：等一轮 macrotask 后 ensureSession 应已被调
    await new Promise(res => setImmediate(res))
    expect(SessionService.ensureSession).toHaveBeenCalled()
  })

  test('assistant 分支：落库但不触发 ensureSession', async () => {
    const save = getHandler('agent:saveMessage')
    const r = await save({}, { sessionId: 's1', role: 'assistant', content: '好的，已按C30设计' })
    expect(r).toEqual({ success: true })
    expect(AgentMemoryService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', role: 'assistant' })
    )
    await new Promise(res => setImmediate(res))
    expect(SessionService.ensureSession).not.toHaveBeenCalled()
  })
})

describe('agent:confirm 行为等价（executor.confirm 全局 fallback）', () => {
  test('无 sessionId 时走全局 orchestrator fallback（getOrchestrator 更新全局时同步 executor.setGlobalFallback）', async () => {
    const setGlobalFallbackSpy = jest.spyOn(getExecutor(), 'setGlobalFallback')
    // 换一个 activeConfig.id，强制 getOrchestrator 重建全局 orchestrator 并重新同步 globalFallback
    require('../../services/SystemService').getActiveLlmConfig.mockResolvedValue({ id: 2, apiKey: 'sk-test-2' })
    const run = getHandler('agent:run')
    await run({ sender: { send: jest.fn() } }, { sessionId: 'warmup', message: 'hi' })

    // 直接验证 getOrchestrator 更新全局时调用了 executor.setGlobalFallback
    expect(setGlobalFallbackSpy).toHaveBeenCalledWith(mockOrchestrator)

    const confirm = getHandler('agent:confirm')
    const r = await confirm({}, { sessionId: undefined, confirmed: true, args: { answer: '继续' } })
    expect(r).toEqual({ success: true })
    expect(mockOrchestrator.resolveConfirmation).toHaveBeenCalledWith(true, { answer: '继续' })
  })
})

describe('agent:archiveSession 行为等价（executor.isSessionRunning）', () => {
  test('运行中会话 isRunning=true，归档被跳过；空闲会话 isRunning=false', async () => {
    const run = getHandler('agent:run')
    let releaseRun
    const gate = new Promise(res => { releaseRun = res })
    mockOrchestrator.run.mockReturnValueOnce(gate)
    const runP = run({ sender: { send: jest.fn() } }, { sessionId: 'run-sess', message: 'hi' })

    // 让 run 的异步初始化（getOrchestratorForSession + 注册会话锁）推进到 await ag.run
    await new Promise(res => setImmediate(res))
    // 此刻 run-sess 处于 running
    let capturedIsRunning = null
    applyArchive.mockImplementation(async ({ sessionIds, archived, isRunning }) => {
      capturedIsRunning = isRunning
      return { updated: 0, skipped: sessionIds.filter(sid => isRunning(sid)) }
    })

    const archive = getHandler('agent:archiveSession')
    const r = await archive(
      { sender: { send: jest.fn(), isDestroyed: () => false } },
      { sessionIds: ['run-sess', 'idle-sess'], archived: true }
    )

    expect(capturedIsRunning).toBeTruthy()
    expect(capturedIsRunning('run-sess')).toBe(true)
    expect(capturedIsRunning('idle-sess')).toBe(false)
    expect(r.skipped).toEqual(['run-sess'])

    releaseRun({ success: true })
    await runP
  })
})
