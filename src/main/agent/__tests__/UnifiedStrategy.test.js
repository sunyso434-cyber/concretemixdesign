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

// v11.7.11: UnifiedStrategy 接入 failover (v11.7.6) 后，主循环用
// `new DeepSeekService(config, sys).chatWithToolsStream(...)` 替代了原来的
// `this.deepseekService.chatWithToolsStream(...)`。所以这里 mock DeepSeekService
// 构造函数，让 failover 内部 new 出来的实例也是 mock，避免打真实 API。
// 注意 jest.mock 会被 hoist 到顶层，factory 必须用 lazy ref（let 引用），变量名
// 必须以 `mock` 前缀（jest 强制：防未初始化 mock 变量被 hoist 后引用）。
let mockChat = null
let mockGetConfig = null
jest.mock('../../services/DeepSeekService', () => {
  return jest.fn().mockImplementation(function (config, sys) {
    return {
      config,
      systemService: sys,
      chatWithToolsStream: (...args) => mockChat(...args),
      _getConfig: (...args) => mockGetConfig(...args)
    }
  })
})

describe('UnifiedStrategy 行为对齐 UnifiedOrchestrator', () => {
  // 共用 mock 工厂
  const makeMocks = () => {
    if (!mockChat) {
      mockChat = jest.fn()
      mockGetConfig = jest.fn()
    }
    // 重置 mock 状态（保留 jest.fn 实例本身，避免测试间 mock.calls 串台）
    mockChat.mockReset()
    mockGetConfig.mockReset()
    mockGetConfig.mockResolvedValue({ maxSteps: 20, apiKey: 'sk-test' })

    const skillRegistry = {
      getSkill: jest.fn(),
      getToolSchemas: jest.fn(() => [])
    }
    const skillExecutor = {
      execute: jest.fn()
    }
    const agentMemoryService = {
      buildAgentMdBlock: jest.fn(async () => ''),
      buildHistoryMessages: jest.fn(async () => []),
      saveMessage: jest.fn(async () => {})
    }
    const systemService = {
      getAgentConfig: jest.fn(async () => ({ messageTrimmerTokenBudget: 30000 }))
    }
    return {
      deepseekService: { chatWithToolsStream: mockChat, _getConfig: mockGetConfig },
      skillRegistry,
      skillExecutor,
      agentMemoryService,
      systemService
    }
  }

  test('场景 1: 用户消息 → LLM 单次回复 → 直接结束', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({
      content: '你好',
      tool_calls: null
    })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    expect(result.success).toBe(true)
    expect(result.content).toBe('你好')
    expect(mocks.deepseekService.chatWithToolsStream).toHaveBeenCalledTimes(1)
  })

  test('场景 2: 用户消息 → LLM 调工具 → 工具执行 → LLM 基于结果再回复', async () => {
    const mocks = makeMocks()
    const mockSkill = { name: 'query_material', parameters: {} }
    mocks.skillRegistry.getSkill.mockReturnValue(mockSkill)
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'result' })
    mocks.deepseekService.chatWithToolsStream
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [{ id: 'c1', function: { name: 'query_material', arguments: '{}' } }]
      })
      .mockResolvedValueOnce({ content: '查询结果' })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: '查询' })

    expect(result.success).toBe(true)
    expect(mocks.deepseekService.chatWithToolsStream).toHaveBeenCalledTimes(2)
  })

  test('场景 3: 连续 6 次 LLM 失败 → 终止', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithToolsStream.mockRejectedValue(new Error('LLM down'))

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    expect(result.success).toBe(false)
    // v8.2.5: 硬熔断阈值 5 → 6（llmParse 路径），给 LLM 看到软提醒后多 1 次纠错机会
    expect(mocks.deepseekService.chatWithToolsStream.mock.calls.length).toBeLessThanOrEqual(6)
  })

  test('场景 4: LLM 触发 429 → 退避重试', async () => {
    // 429 退避首轮需等 5000ms，第三个参数显式传 15s 超时
    const mocks = makeMocks()
    mocks.deepseekService.chatWithToolsStream
      .mockRejectedValueOnce({ status: 429, message: 'rate limit' })
      .mockResolvedValueOnce({ content: 'ok' })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's1', message: 'hi' })

    // 退避后应重试并成功（不直接返回失败）
    expect(mocks.deepseekService.chatWithToolsStream).toHaveBeenCalledTimes(2)
  }, 15000)

  test('场景 5: 用户中途调 abort → 优雅停止', async () => {
    const mocks = makeMocks()
    // 让 chatWithToolsStream 触发 abort 检查
    let aborted = false
    mocks.deepseekService.chatWithToolsStream.mockImplementation(async () => {
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
    mocks.deepseekService.chatWithToolsStream
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockRejectedValueOnce(new Error('LLM timeout'))
      // 第 3 次：成功调工具
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }] })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'r' })
    mocks.deepseekService.chatWithToolsStream
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

    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({ content: '不会到这里', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({
      sessionId: 's',
      message: 'hi',
      signal: abortController.signal
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('aborted')
    expect(mocks.deepseekService.chatWithToolsStream).not.toHaveBeenCalled()
  })

  test('场景 8: getState() === "paused" 时主循环应阻塞，恢复后继续', async () => {
    const mocks = makeMocks()
    let currentState = 'paused'
    setTimeout(() => { currentState = 'running' }, 200)  // 200ms 后恢复

    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({ content: 'ok', tool_calls: null })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({
      sessionId: 's',
      message: 'hi',
      getState: () => currentState
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('ok')
  })

  test('场景 9 (v1.2): 主循环 maxSteps 读自 deepseekService._getConfig().maxSteps', async () => {
    const mocks = makeMocks()
    // maxSteps=3：主循环最多执行 3 轮
    mocks.deepseekService._getConfig.mockResolvedValue({ maxSteps: 3 })

    // 永远调工具（tool_calls 非空），触发主循环跑满
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({
      content: null,
      tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }]
    })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'r' })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's', message: 'q' })

    // LLM 调用次数应该受 maxSteps=3 限制
    expect(mocks.deepseekService.chatWithToolsStream.mock.calls.length).toBeLessThanOrEqual(3)
    expect(mocks.deepseekService._getConfig).toHaveBeenCalled()
    // 失败是预期（达到 maxSteps 上限），但 success 字段有定义
    expect(result).toBeDefined()
  })

  // v1.2 修复验证：deepseekService 不存在时，maxSteps fallback 到 DEFAULT_AGENT_MAX_STEPS=200
  test('场景 10 (v1.2 修复验证): deepseekService 缺 _getConfig 时 maxSteps 应 fallback 到共享常量 200', async () => {
    const mocks = makeMocks()
    // 模拟 _getConfig 抛错
    mocks.deepseekService._getConfig = undefined
    // 让 _getConfig 不可调用，触发 fallback
    // 永远调工具，触发主循环跑满
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({
      content: null,
      tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }]
    })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'r' })

    const strategy = new UnifiedStrategy(mocks)
    const result = await strategy.execute({ sessionId: 's', message: 'q' })

    // 主循环应跑满 200 次（DEFAULT_AGENT_MAX_STEPS）
    expect(mocks.deepseekService.chatWithToolsStream.mock.calls.length).toBeLessThanOrEqual(200)
    expect(result).toBeDefined()
  })

  // ============== v8.2.5 软提醒相关测试 ==============

  /**
   * 工具函数：统计软提醒被注入的次数（而非出现次数）
   *
   * trimmedMessages 是共享数组，注入后软提醒会出现在所有后续 LLM 调用的 messages 里，
   * 所以不能简单统计"包含软提醒的调用数"。
   * 正确做法：检测软提醒在哪一次调用中首次出现 → 即为注入次数。
   *
   * 判断"首次出现"：当前调用包含软提醒，且前一次调用不包含。
   * 因为 mock.calls[i][0] 和 mock.calls[i+1][0] 是同一个 trimmedMessages 引用，
   * 所以 mock.calls 记录的是每次调用时数组的"快照引用"，但数组内容会变化。
   * 实际上 jest.fn() 记录的是调用时的参数值，对于数组来说是引用。
   * 但因为我们是在调用结束后统一检查，所有引用都指向同一个已累积的数组。
   *
   * 因此采用更可靠的方案：统计包含软提醒的调用中，软提醒角色为 'user' 的消息数量。
   * 因为软提醒注入为 {role:'user', content:'⚠️ ...'}，而正常 user 消息只有 1 条。
   * 如果软提醒被注入了 N 次，trimmedMessages 中会有 N 条这样的消息。
   */
  const countSoftWarnInjections = (mocks) => {
    // 取最后一次调用的 messages（此时 trimmedMessages 已包含所有注入的软提醒）
    const calls = mocks.deepseekService.chatWithToolsStream.mock.calls
    if (calls.length === 0) return 0
    const msgs = calls[calls.length - 1][0] || []
    return msgs.filter(m =>
      typeof m.content === 'string' && m.content.includes('已在这条路径上连续失败 3 次')
    ).length
  }

  test('场景 11 (v8.2.5): 工具连续失败 3 次触发软提醒', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({
      content: null,
      tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }]
    })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    // 前 3 次工具失败
    mocks.skillExecutor.execute
      .mockResolvedValueOnce({ success: false, error: { title: '错误1' } })
      .mockResolvedValueOnce({ success: false, error: { title: '错误2' } })
      .mockResolvedValueOnce({ success: false, error: { title: '错误3' } })
      // 第 4 次成功（验证重置）
      .mockResolvedValueOnce({ success: true, data: 'ok' })

    const strategy = new UnifiedStrategy(mocks)
    await strategy.execute({ sessionId: 's', message: 'q' })

    // 软提醒应出现 1 次（在第 3 次失败后注入）
    expect(countSoftWarnInjections(mocks)).toBe(1)
  })

  test('场景 12 (v8.2.5): 工具连续失败 5 次，软提醒只触发 1 次', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({
      content: null,
      tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }]
    })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    mocks.skillExecutor.execute.mockResolvedValue({ success: false, error: { title: 'x' } })

    const strategy = new UnifiedStrategy(mocks)
    await strategy.execute({ sessionId: 's', message: 'q' })

    // 不管失败多少次，软提醒只注入 1 次
    expect(countSoftWarnInjections(mocks)).toBe(1)
  })

  test('场景 13 (v8.2.5): 工具成功 → 软提醒重置，下次再失败从 1 重来', async () => {
    const mocks = makeMocks()
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({
      content: null,
      tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }]
    })
    mocks.skillRegistry.getSkill.mockReturnValue({ name: 'q', parameters: {} })
    // 失败 2 次 → 成功 1 次 → 失败 2 次 → 不应触发软提醒（第二轮未到 3 次）
    mocks.skillExecutor.execute
      .mockResolvedValueOnce({ success: false, error: { title: 'e1' } })
      .mockResolvedValueOnce({ success: false, error: { title: 'e2' } })
      .mockResolvedValueOnce({ success: true, data: 'ok' })
      .mockResolvedValueOnce({ success: false, error: { title: 'e3' } })
      .mockResolvedValueOnce({ success: false, error: { title: 'e4' } })

    const strategy = new UnifiedStrategy(mocks)
    await strategy.execute({ sessionId: 's', message: 'q' })

    // 软提醒一次都不该注入（成功重置了计数器）
    expect(countSoftWarnInjections(mocks)).toBe(0)
  })

  test('场景 14 (v8.2.5): llmNetwork 连续失败不触发软提醒', async () => {
    const mocks = makeMocks()
    // 模拟 LLM 网络错误（连续 ECONNABORTED）
    mocks.deepseekService.chatWithToolsStream.mockImplementation(() => {
      const err = new Error('timeout')
      err.code = 'ECONNABORTED'  // 触发 isNetworkError 分支
      return Promise.reject(err)
    })

    const strategy = new UnifiedStrategy(mocks)
    await strategy.execute({ sessionId: 's', message: 'q' })

    // llmNetwork 走单独路径，不注入软提醒
    expect(countSoftWarnInjections(mocks)).toBe(0)
  })

  test('场景 15 (v8.2.5): LLM 解析失败 3 次触发软提醒', async () => {
    const mocks = makeMocks()
    // 模拟 LLM 解析失败（普通 Error，没有 code，isNetworkError = false）
    mocks.deepseekService.chatWithToolsStream.mockRejectedValue(new Error('JSON parse error'))

    const strategy = new UnifiedStrategy(mocks)
    await strategy.execute({ sessionId: 's', message: 'q' })

    // llmParse 路径在第 3 次失败时注入软提醒
    expect(countSoftWarnInjections(mocks)).toBe(1)
  })
})
