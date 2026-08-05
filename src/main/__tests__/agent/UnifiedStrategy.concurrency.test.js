/**
 * UnifiedStrategy 读写分组并发（阶段 2 任务 2.3）
 *
 * 需求：
 * - READ 工具并发执行（Promise.all），WRITE 工具串行执行（for loop）
 * - 结果按原始 tool_call_id 顺序合并回 trimmedMessages
 * - 前端进度事件顺序对齐：并发批次先按请求顺序发所有 tool_start，
 *   完成后再按请求顺序发 tool_done（与实际完成顺序无关）
 * - 写工具逐个自然排序（start → done）
 *
 * mock 模式参照 UnifiedStrategy.steer.test.js（DeepSeekService 构造函数 mock + contextStats mock）。
 */

const UnifiedStrategy = require('../../agent/strategies/UnifiedStrategy')

let mockChat = null
let mockGetConfig = null
jest.mock('../../services/DeepSeekService', () => {
  return jest.fn().mockImplementation(function (config, sys) {
    return { config, systemService: sys, chatWithToolsStream: (...args) => mockChat(...args), _getConfig: (...args) => mockGetConfig(...args) }
  })
})
let mockEstimateTokens
jest.mock('../../../shared/utils/contextStats', () => ({ estimateTokens: (...args) => mockEstimateTokens(...args) }))

// sqlite3 原生模块在本环境加载即段错误，mock db/database 规避（同 steer 测试惯例）。
jest.mock('../../db/database', () => ({}))

const makeOrchestrator = () => ({
  steer: jest.fn(),
  drainSteering: jest.fn(() => []),
  drainFollowUp: jest.fn(() => []),
  isInterrupted: jest.fn(() => false),
  clearInterrupt: jest.fn(),
  requestInterrupt: jest.fn(),
  cancelPendingConfirmation: jest.fn(),
  resume: jest.fn(),
  state: 'running'
})

const makeMocks = (orch) => {
  if (!mockChat) { mockChat = jest.fn(); mockGetConfig = jest.fn() }
  mockChat.mockReset()
  mockGetConfig.mockReset()
  mockGetConfig.mockResolvedValue({ maxSteps: 20, apiKey: 'sk-test' })
  const skillRegistry = { getSkill: jest.fn(), getToolSchemas: jest.fn(() => []) }
  const skillExecutor = { execute: jest.fn() }
  const agentMemoryService = {
    buildAgentMdBlock: jest.fn(async () => ''),
    buildHistoryMessages: jest.fn(async () => []),
    saveMessage: jest.fn(async () => {}),
    synthToolResults: jest.fn(async () => [])
  }
  const systemService = { getAgentConfig: jest.fn(async () => ({ messageTrimmerTokenBudget: 30000 })) }
  return { deepseekService: { chatWithToolsStream: mockChat, _getConfig: mockGetConfig }, skillRegistry, skillExecutor, agentMemoryService, systemService, orchestrator: orch || makeOrchestrator() }
}

// 捕获 agent:progress 事件的 mock webContents
const makeWebContents = (events) => ({
  send: (channel, data) => { if (channel === 'agent:progress') events.push(data) },
  isDestroyed: jest.fn(() => false)
})

describe('UnifiedStrategy 读写分组并发（Task 2.3）', () => {
  beforeEach(() => { mockEstimateTokens = jest.fn(() => 1000) })

  test('3 个读工具并发执行 + 2 个写工具串行执行，写工具不进并发组', async () => {
    const orch = makeOrchestrator()
    const mocks = makeMocks(orch)
    const DELAYS = { read1: 120, read2: 30, read3: 70, write1: 40, write2: 40 }
    mocks.skillRegistry.getSkill.mockImplementation((name) => ({
      name,
      parameters: {},
      isWrite: name.startsWith('write')  // write1/write2 标记为写操作
    }))
    const windows = []   // { name, start, end } 执行窗口
    const execOrder = [] // execute 被调用的顺序
    mocks.skillExecutor.execute.mockImplementation(async (name) => {
      execOrder.push(name)
      const start = Date.now()
      await new Promise(r => setTimeout(r, DELAYS[name] || 0))
      windows.push({ name, start, end: Date.now() })
      return { success: true, data: `${name}-ok` }
    })
    mockChat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'r1', function: { name: 'read1', arguments: '{}' } },
          { id: 'r2', function: { name: 'read2', arguments: '{}' } },
          { id: 'r3', function: { name: 'read3', arguments: '{}' } },
          { id: 'w1', function: { name: 'write1', arguments: '{}' } },
          { id: 'w2', function: { name: 'write2', arguments: '{}' } }
        ]
      })
      .mockResolvedValueOnce({ content: '完成', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })
    expect(result.success).toBe(true)

    // ① 3 个读工具在写工具之前一起发起（并发批次）
    expect(execOrder.slice(0, 3)).toEqual(['read1', 'read2', 'read3'])
    expect(execOrder.slice(3)).toEqual(['write1', 'write2'])

    // ② 读工具执行窗口两两重叠 → 真并发
    const readWindows = windows.filter(w => w.name.startsWith('read'))
    expect(readWindows.length).toBe(3)
    const overlap = (a, b) => a.start < b.end && b.start < a.end
    expect(overlap(readWindows[0], readWindows[1])).toBe(true)
    expect(overlap(readWindows[0], readWindows[2])).toBe(true)
    expect(overlap(readWindows[1], readWindows[2])).toBe(true)

    // ③ 写工具执行窗口互不重叠 → 串行；写工具不在读并发组内
    const writeWindows = windows.filter(w => w.name.startsWith('write'))
    expect(writeWindows.length).toBe(2)
    expect(overlap(writeWindows[0], writeWindows[1])).toBe(false)
    const maxReadEnd = Math.max(...readWindows.map(w => w.end))
    for (const ww of writeWindows) {
      // 写工具必须开始于读批次结束之后（允许毫秒级时序误差）
      expect(ww.start).toBeGreaterThanOrEqual(maxReadEnd - 10)
    }
  })

  test('前端事件顺序：3 个读工具 tool_start/tool_done 按请求顺序，即使完成顺序不同', async () => {
    const orch = makeOrchestrator()
    const mocks = makeMocks(orch)
    const events = []
    const mockWebContents = makeWebContents(events)
    // 完成顺序故意与请求顺序不同：r1 最慢(120ms)、r2 最快(20ms)、r3 中(60ms)
    const DELAYS = { r1: 120, r2: 20, r3: 60 }
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'x', parameters: {} })  // 无 isWrite → 读
    const completeOrder = []
    mocks.skillExecutor.execute.mockImplementation(async (name) => {
      await new Promise(r => setTimeout(r, DELAYS[name] || 0))
      completeOrder.push(name)
      return { success: true, data: 'ok' }
    })
    mockChat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'r1', function: { name: 'r1', arguments: '{}' } },
          { id: 'r2', function: { name: 'r2', arguments: '{}' } },
          { id: 'r3', function: { name: 'r3', arguments: '{}' } }
        ]
      })
      .mockResolvedValueOnce({ content: '完成', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi', webContents: mockWebContents })
    expect(result.success).toBe(true)

    // 前提：真实完成顺序确实与请求顺序不同（保证测试有意义）
    expect(completeOrder).toEqual(['r2', 'r3', 'r1'])

    const starts = events.filter(e => e.type === 'tool_start').map(e => e.toolCallId)
    const dones = events.filter(e => e.type === 'tool_done').map(e => e.toolCallId)
    expect(starts).toEqual(['r1', 'r2', 'r3'])
    expect(dones).toEqual(['r1', 'r2', 'r3'])

    // 全量序列：所有 tool_start 在 tool_done 之前（并发批次先发开始、完成后再按请求序发结束）
    const seq = events
      .filter(e => e.type === 'tool_start' || e.type === 'tool_done')
      .map(e => `${e.type}:${e.toolCallId}`)
    expect(seq).toEqual([
      'tool_start:r1', 'tool_start:r2', 'tool_start:r3',
      'tool_done:r1', 'tool_done:r2', 'tool_done:r3'
    ])
  })

  test('写工具 tool_start/tool_done 逐个自然排序（串行，非并发组）', async () => {
    const orch = makeOrchestrator()
    const mocks = makeMocks(orch)
    const events = []
    const mockWebContents = makeWebContents(events)
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'x', parameters: {}, isWrite: true })
    mocks.skillExecutor.execute.mockImplementation(async (name) => {
      await new Promise(r => setTimeout(r, 20))
      return { success: true, data: 'ok' }
    })
    mockChat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'w1', function: { name: 'write1', arguments: '{}' } },
          { id: 'w2', function: { name: 'write2', arguments: '{}' } }
        ]
      })
      .mockResolvedValueOnce({ content: '完成', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi', webContents: mockWebContents })
    expect(result.success).toBe(true)

    const seq = events
      .filter(e => e.type === 'tool_start' || e.type === 'tool_done')
      .map(e => `${e.type}:${e.toolCallId}`)
    // 写工具串行：start w1 → done w1 → start w2 → done w2
    expect(seq).toEqual([
      'tool_start:w1', 'tool_done:w1',
      'tool_start:w2', 'tool_done:w2'
    ])
  })

  // 审查 Finding 1：交错读写请求时，结果必须按原始 tool_calls 全序列顺序合并，
  // 而非"读组整体在前、写组整体在后"。
  test('交错读写请求：结果按原始 tool_calls 全序列顺序合并（非读组整体在前）', async () => {
    const mocks = makeMocks()
    mocks.skillRegistry.getSkill.mockImplementation((name) => ({ name, parameters: {}, isWrite: name.startsWith('write') }))
    mocks.skillExecutor.execute.mockImplementation(async (name) => ({ success: true, data: `${name}-result` }))
    mockChat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'w1', function: { name: 'write1', arguments: '{}' } },
          { id: 'r1', function: { name: 'read1', arguments: '{}' } },
          { id: 'w2', function: { name: 'write2', arguments: '{}' } },
          { id: 'r2', function: { name: 'read2', arguments: '{}' } }
        ]
      })
      .mockResolvedValueOnce({ content: '完成', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })
    expect(result.success).toBe(true)

    // 第二轮 LLM 收到的 tool 消息必须按请求序 [write1, read1, write2, read2]
    const secondMsgs = mockChat.mock.calls[1][0]
    const toolMsgs = secondMsgs.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).data)
    expect(toolMsgs).toEqual(['write1-result', 'read1-result', 'write2-result', 'read2-result'])
  })

  // 审查 Finding 2：全写批次时，第一个写工具必须先执行，再检查 steer/interrupt，
  // 剩余写工具才补合成——不能整批跳过。
  test('全写批次 + 已插话：第一个写工具先执行，剩余补合成（不整批跳过）', async () => {
    const orch = makeOrchestrator()
    const mocks = makeMocks(orch)
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'x', parameters: {}, isWrite: true })
    const executed = []
    mocks.skillExecutor.execute.mockImplementation(async (name) => {
      executed.push(name)
      return { success: true, data: `${name}-ok` }
    })
    // 还原真实 synthToolResults 落库行为（saveMessage + synth metadata）
    mocks.agentMemoryService.synthToolResults.mockImplementation(async (_sid, toolCalls, executedIds) => {
      const out = []
      for (const tc of toolCalls) {
        if (executedIds.has(tc.id)) continue
        const content = JSON.stringify({ success: false, error: 'Interrupted by user', interrupted_tool: tc.function.name })
        await mocks.agentMemoryService.saveMessage({ sessionId: 's1', role: 'tool', content, toolCallId: tc.id, metadata: { synth: true } })
        out.push({ role: 'tool', tool_call_id: tc.id, content })
      }
      return out
    })
    mockChat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'w1', function: { name: 'w1', arguments: '{}' } },
          { id: 'w2', function: { name: 'w2', arguments: '{}' } },
          { id: 'w3', function: { name: 'w3', arguments: '{}' } }
        ]
      })
      .mockResolvedValueOnce({ content: '已处理插话', tool_calls: null })
    // drainSteering 调用顺序：
    //   ① 主循环顶部第 1 轮 drain → []（空）
    //   ② 第一个写工具 w1 执行后 drain → ['用户插话']（触发插话，KEY）
    //   ③+ 主循环顶部第 2 轮 / 完成判定前 → 空
    orch.drainSteering
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['用户插话'])
      .mockReturnValue([])

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })
    expect(result.success).toBe(true)

    // 第一个写工具 w1 真实执行，w2/w3 被合成（未被整批跳过）
    expect(executed).toEqual(['w1'])
    expect(mocks.agentMemoryService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', toolCallId: 'w2', metadata: expect.objectContaining({ synth: true }) })
    )
    expect(mocks.agentMemoryService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', toolCallId: 'w3', metadata: expect.objectContaining({ synth: true }) })
    )
  })
})
