/**
 * UnifiedStrategy Enter 工具边界插话（Task 6）
 *
 * 场景：LLM 一次返回多个 tool_call，当前 tool（A）执行完成后 drain 到 steering 插话
 * → 对尚未执行的 tool_call（B/C）补合成 tool_result（双写：saveMessage 落库 + push trimmedMessages）
 * → 注入插话 user 消息（双写）→ break 出 tool 循环 → 下一轮 LLM 看到完整序列（A 真实结果 + B/C 合成 + 插话）。
 *
 * mock 模式参照 src/main/agent/__tests__/UnifiedStrategy.test.js（DeepSeekService 构造函数 mock + contextStats mock）。
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

// sqlite3 原生模块在本环境（Node 20.20.2 非 Electron）加载即段错误，mock db/database 规避。
// UnifiedStrategy 顶层 require('../../db/database') 会连带加载 sqlite3 → 崩溃（本项目测试不碰真实 DB）。
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

describe('UnifiedStrategy Enter 工具边界插话（Task 6）', () => {
  beforeEach(() => { mockEstimateTokens = jest.fn(() => 1000) })

  test('多个 tool 时，A 执行完 drain 到插话 → 剩余 B/C 补合成 + 插话注入 + 下一轮 LLM 看到完整序列', async () => {
    const orch = makeOrchestrator()
    const mocks = makeMocks(orch)
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'tool', parameters: {} })
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'ok' })
    // 第 1 次：返回 3 个 tool_call；第 2 次：返回纯文本结束
    mockChat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'A', function: { name: 'tool_a', arguments: '{}' } },
          { id: 'B', function: { name: 'tool_b', arguments: '{}' } },
          { id: 'C', function: { name: 'tool_c', arguments: '{}' } }
        ]
      })
      .mockResolvedValueOnce({ content: '收到，改用 zod', tool_calls: null })
    // B/C 合成返回 2 条消息。mock 需还原真实 synthToolResults 的落库行为（Task 4 内部会 saveMessage），
    // 否则"合成已落库"断言无从成立。
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
    // drainSteering 实际调用顺序：
    //   ① 主循环顶部第 1 轮 drain → []（空）
    //   ② A 执行完 tool 循环内 drain → ['改用 zod']（触发插话，KEY）
    //   ③ 主循环顶部第 2 轮 drain → []（插话已在 ② 被取走）
    //   ④ 完成判定前 drain（第 2 轮 LLM 返回纯文本时）→ []（其余回退 → []）
    orch.drainSteering
      .mockReturnValueOnce([])           // ① 主循环顶部第 1 轮
      .mockReturnValueOnce(['改用 zod']) // ② A 执行完 tool 循环内 drain → 触发插话
      .mockReturnValue([])               // ③④+ 主循环顶部第 2 轮 / 完成判定前 → 空

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    expect(result.success).toBe(true)
    // 第 2 次 LLM 调用收到的消息里包含 A 真实结果 + B/C 合成 + 插话
    const secondCallMsgs = mockChat.mock.calls[1][0]
    const toolIds = secondCallMsgs.filter(m => m.role === 'tool').map(m => m.tool_call_id)
    expect(toolIds).toEqual(expect.arrayContaining(['A', 'B', 'C']))
    const steerUserMsg = secondCallMsgs.find(m => m.role === 'user' && m.content === '改用 zod')
    expect(steerUserMsg).toBeTruthy()
    // 合成结果已落库
    expect(mocks.agentMemoryService.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'tool', toolCallId: 'B', metadata: expect.objectContaining({ synth: true }) }))
  })

  // Task 7：问题 D — ask_user 被插话打断（INTERRUPTED_BY_STEER）不当失败记账，不触发熔断
  test('ask_user 连续被打断（INTERRUPTED_BY_STEER）不递增 skillExec → 不熔断，正常完成', async () => {
    const orch = makeOrchestrator()
    const mocks = makeMocks(orch)
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'ask_user', parameters: {} })
    // 8 次全返回中断（若 skillExec 递增则第 6 次熔断），第 9 次返回纯文本
    for (let i = 0; i < 8; i++) {
      mockChat.mockResolvedValueOnce({
        content: null,
        tool_calls: [{ id: `ask${i}`, function: { name: 'ask_user', arguments: '{"question":"x"}' } }]
      })
    }
    mockChat.mockResolvedValueOnce({ content: '完成了', tool_calls: null })
    mocks.skillExecutor.execute.mockResolvedValue({ success: false, error: 'INTERRUPTED_BY_STEER', interrupted: true })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    expect(result.success).toBe(true)
    // 打断时 tool 消息仍落库（LLM 看到中断）
    expect(mocks.agentMemoryService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('interrupted') })
    )
  })
})
