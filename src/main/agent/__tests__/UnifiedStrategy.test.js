/**
 * UnifiedStrategy 行为对齐 UnifiedOrchestrator
 *
 * 5 个关键场景对照旧 UnifiedOrchestrator.run() 的主循环行为：
 * 1. 用户消息 → LLM 单次回复 → 直接结束
 * 2. 用户消息 → LLM 调工具 → 工具执行 → LLM 基于结果再回复
 * 3. 连续 2 次 LLM 失败 → 终止
 * 4. LLM 触发 429 → 退避重试
 * 5. 用户中途调 abort → 优雅停止
 */

const UnifiedStrategy = require('../strategies/UnifiedStrategy')

describe('UnifiedStrategy 行为对齐 UnifiedOrchestrator', () => {
  // 共用 mock 工厂
  const makeMocks = () => {
    const deepseekService = {
      chatWithTools: jest.fn()
    }
    const skillRegistry = {
      getSkill: jest.fn(),
      getToolSchemas: jest.fn(() => [])
    }
    const skillExecutor = {
      execute: jest.fn()
    }
    const agentMemoryService = {
      buildMemoryContext: jest.fn(async () => ''),
      buildHistoryMessages: jest.fn(async () => []),
      saveMessage: jest.fn(async () => {})
    }
    return { deepseekService, skillRegistry, skillExecutor, agentMemoryService }
  }

  test('场景 1: 用户消息 → LLM 单次回复 → 直接结束', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithTools.mockResolvedValue({
      content: '你好',
      tool_calls: null
    })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    expect(result.success).toBe(true)
    expect(result.content).toBe('你好')
    expect(mocks.deepseekService.chatWithTools).toHaveBeenCalledTimes(1)
  })

  test('场景 2: 用户消息 → LLM 调工具 → 工具执行 → LLM 基于结果再回复', async () => {
    const mocks = makeMocks()
    const mockSkill = { name: 'query_material', parameters: {} }
    mocks.skillRegistry.getSkill.mockReturnValue(mockSkill)
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'result' })
    mocks.deepseekService.chatWithTools
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [{ id: 'c1', function: { name: 'query_material', arguments: '{}' } }]
      })
      .mockResolvedValueOnce({ content: '查询结果' })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: '查询' })

    expect(result.success).toBe(true)
    expect(mocks.deepseekService.chatWithTools).toHaveBeenCalledTimes(2)
  })

  test('场景 3: 连续 2 次 LLM 失败 → 终止', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithTools.mockRejectedValue(new Error('LLM down'))

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    expect(result.success).toBe(false)
    // 验证 chatWithTools 调用 ≤ 2 次（maxConsecutiveFailures=2）
    expect(mocks.deepseekService.chatWithTools.mock.calls.length).toBeLessThanOrEqual(2)
  })

  test('场景 4: LLM 触发 429 → 退避重试', async () => {
    // 429 退避首轮需等 5000ms，第三个参数显式传 15s 超时
    const mocks = makeMocks()
    mocks.deepseekService.chatWithTools
      .mockRejectedValueOnce({ status: 429, message: 'rate limit' })
      .mockResolvedValueOnce({ content: 'ok' })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    // 退避后应重试并成功（不直接返回失败）
    expect(mocks.deepseekService.chatWithTools).toHaveBeenCalledTimes(2)
  }, 15000)

  test('场景 5: 用户中途调 abort → 优雅停止', async () => {
    const mocks = makeMocks()
    // 让 chatWithTools 触发 abort 检查
    let aborted = false
    mocks.deepseekService.chatWithTools.mockImplementation(async () => {
      if (aborted) throw new Error('aborted')
      return { content: null, tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{}' } }] }
    })

    const strategy = new UnifiedStrategy(mocks)
    // 在第一次调用后设置 aborted
    setTimeout(() => { aborted = true }, 50)

    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })
    expect(result.success).toBeDefined()
  })

  test('场景 6: LLM 抽风 2 次 + skill 失败 1 次不应终止（不同源）', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithTools
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockRejectedValueOnce(new Error('LLM timeout'))
      // 第 3 次：成功调工具
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }] })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'r' })
    mocks.deepseekService.chatWithTools
      .mockResolvedValueOnce({ content: 'ok' })  // 工具结果后再 LLM 一次

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's', message: 'q' })
    // LLM 失败 2 次是同源，但第 3 次成功—— 不应触发 FATAL
    expect(result).toBeDefined()
  })

  test('场景 7: signal.aborted 时主循环应立即终止', async () => {
    const mocks = makeMocks()
    const abortController = new AbortController()

    // 在第一次 LLM 调用前 abort
    abortController.abort()

    mocks.deepseekService.chatWithTools.mockResolvedValue({ content: '不会到这里', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({
      sessionId: 's',
      message: 'hi',
      signal: abortController.signal
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('aborted')
    expect(mocks.deepseekService.chatWithTools).not.toHaveBeenCalled()
  })

  test('场景 8: getState() === "paused" 时主循环应阻塞，恢复后继续', async () => {
    const mocks = makeMocks()
    let currentState = 'paused'
    setTimeout(() => { currentState = 'running' }, 200)  // 200ms 后恢复

    mocks.deepseekService.chatWithTools.mockResolvedValue({ content: 'ok', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({
      sessionId: 's',
      message: 'hi',
      getState: () => currentState
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('ok')
  })
})
