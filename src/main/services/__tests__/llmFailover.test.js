// v11.7.9: LLM failover 单元测试 — 所有错误都触发切换 + 激活配置优先

const { tryWithFailover, isRetryableError, RETRYABLE_CODES, prioritizeActiveFirst } = require('../llmFailover')

describe('isRetryableError (v11.7.5: 全部返回 true)', () => {
  test('所有错误码都返回 true（不再按错误码区分）', () => {
    expect(isRetryableError({ code: 'E-LLM-429' })).toBe(true)
    expect(isRetryableError({ code: 'E-LLM-500' })).toBe(true)
    expect(isRetryableError({ code: 'E-LLM-503' })).toBe(true)
    expect(isRetryableError({ code: 'E-NET-408' })).toBe(true)
    expect(isRetryableError({ code: 'E-NET-500' })).toBe(true)
  })
  test('原来不可重试的现在也返回 true', () => {
    expect(isRetryableError({ code: 'E-LLM-401' })).toBe(true)
    expect(isRetryableError({ code: 'E-LLM-400' })).toBe(true)
    expect(isRetryableError({ code: 'E-LLM-402' })).toBe(true)
  })
  test('null/undefined 也返回 true', () => {
    expect(isRetryableError(null)).toBe(true)
    expect(isRetryableError(undefined)).toBe(true)
    expect(isRetryableError({})).toBe(true)
  })
})

describe('tryWithFailover', () => {
  const mockConfigs = [
    { id: 'c1', name: 'DeepSeek', provider: 'deepseek', apiKey: 'sk-d1', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
    { id: 'c2', name: 'MiniMax', provider: 'minimax', apiKey: 'sk-m1', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M3' },
    { id: 'c3', name: 'OpenAI', provider: 'openai', apiKey: 'sk-o1', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ]

  test('第一个就成功 → 不触发 onSwitch', async () => {
    const tryFn = jest.fn().mockResolvedValue({ reply: 'hello' })
    const onSwitch = jest.fn()

    const { result } = await tryWithFailover(mockConfigs, tryFn, onSwitch)

    expect(result.reply).toBe('hello')
    expect(tryFn).toHaveBeenCalledTimes(1)
    expect(tryFn).toHaveBeenCalledWith(mockConfigs[0])
    expect(onSwitch).not.toHaveBeenCalled()
  })

  test('第一个失败 → 第二个成功 → 触发 onSwitch', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce({ code: 'E-NET-500', message: '网络不通' })
      .mockResolvedValueOnce({ reply: 'from minimax' })
    const onSwitch = jest.fn()

    const { result } = await tryWithFailover(mockConfigs, tryFn, onSwitch)

    expect(result.reply).toBe('from minimax')
    expect(tryFn).toHaveBeenCalledTimes(2)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('DeepSeek', 'MiniMax', 'E-NET-500')
  })

  test('v11.7.5: 401 错误也继续尝试下一个（每个 config 密钥不同）', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce({ code: 'E-LLM-401', message: 'DeepSeek密钥无效' })
      .mockResolvedValueOnce({ reply: 'from minimax' })

    const { result } = await tryWithFailover(mockConfigs, tryFn, jest.fn())

    expect(result.reply).toBe('from minimax')
    expect(tryFn).toHaveBeenCalledTimes(2)  // 第一个失败 401，继续试第二个
  })

  test('v11.7.5: 400 错误也继续尝试下一个（config 参数可能不兼容）', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce({ code: 'E-LLM-400', message: '参数错误' })
      .mockResolvedValueOnce({ reply: 'from minimax' })

    const { result } = await tryWithFailover(mockConfigs, tryFn, jest.fn())

    expect(result.reply).toBe('from minimax')
    expect(tryFn).toHaveBeenCalledTimes(2)  // 第一个失败 400，继续试第二个
  })

  test('全部失败 → 抛最后一个错误', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce({ code: 'E-NET-500' })
      .mockRejectedValueOnce({ code: 'E-LLM-429' })
      .mockRejectedValueOnce({ code: 'E-LLM-503', message: '最后一个' })

    await expect(tryWithFailover(mockConfigs, tryFn, jest.fn()))
      .rejects.toEqual({ code: 'E-LLM-503', message: '最后一个' })

    expect(tryFn).toHaveBeenCalledTimes(3)
  })

  test('v11.7.5: 所有都失败（包括401）→ 全部试完再抛最后错误', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce({ code: 'E-NET-500' })
      .mockRejectedValueOnce({ code: 'E-LLM-429' })
      .mockRejectedValueOnce({ code: 'E-LLM-401', message: 'key wrong' })

    await expect(tryWithFailover(mockConfigs, tryFn, jest.fn()))
      .rejects.toEqual({ code: 'E-LLM-401', message: 'key wrong' })

    expect(tryFn).toHaveBeenCalledTimes(3)  // 三个都试了
  })

  test('空配置列表 → 抛错', async () => {
    await expect(tryWithFailover([], jest.fn(), jest.fn()))
      .rejects.toThrow('没有可用的 LLM 配置')
  })

  test('所有配置都没 API Key → 抛错', async () => {
    const noKeyConfigs = [
      { id: 'c1', name: 'A', apiKey: '' },
      { id: 'c2', name: 'B', apiKey: null },
    ]
    await expect(tryWithFailover(noKeyConfigs, jest.fn(), jest.fn()))
      .rejects.toThrow('所有 LLM 配置均未填写 API Key')
  })

  test('只有一个配置时行为不变', async () => {
    const singleConfig = [mockConfigs[0]]
    const tryFn = jest.fn().mockResolvedValue({ reply: 'ok' })

    const { result } = await tryWithFailover(singleConfig, tryFn, jest.fn())

    expect(result.reply).toBe('ok')
    expect(tryFn).toHaveBeenCalledTimes(1)
  })

  test('onSwitch 只触发一次（多个配置失败时不会重复通知）', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce({ code: 'E-NET-500' })
      .mockRejectedValueOnce({ code: 'E-LLM-429' })
      .mockResolvedValueOnce({ reply: 'third works' })
    const onSwitch = jest.fn()

    await tryWithFailover(mockConfigs, tryFn, onSwitch)

    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('DeepSeek', 'OpenAI', 'E-LLM-429')
  })
})

describe('prioritizeActiveFirst（v11.7.9 新增）', () => {
  const cA = { id: 'a', name: 'A' }
  const cB = { id: 'b', name: 'B' }
  const cC = { id: 'c', name: 'C' }

  test('激活 ID 在中间 → 排到第一位', () => {
    const result = prioritizeActiveFirst([cA, cB, cC], 'b')
    expect(result[0].id).toBe('b')
    expect(result).toHaveLength(3)
  })

  test('激活 ID 已排第一位 → 不变', () => {
    const result = prioritizeActiveFirst([cA, cB, cC], 'a')
    expect(result[0].id).toBe('a')
    expect(result).toEqual([cA, cB, cC])
  })

  test('激活 ID 在末尾 → 排到第一位', () => {
    const result = prioritizeActiveFirst([cA, cB, cC], 'c')
    expect(result[0].id).toBe('c')
    expect(result).toHaveLength(3)
  })

  test('只有1个配置 → 不变', () => {
    const result = prioritizeActiveFirst([cA], 'a')
    expect(result).toEqual([cA])
  })

  test('activeId 为 null → 保持原序', () => {
    const result = prioritizeActiveFirst([cA, cB, cC], null)
    expect(result).toEqual([cA, cB, cC])
  })

  test('activeId 不存在 → 保持原序', () => {
    const result = prioritizeActiveFirst([cA, cB, cC], 'notfound')
    expect(result).toEqual([cA, cB, cC])
  })

  test('数组中有空值 → 安全处理', () => {
    const result = prioritizeActiveFirst([cA, null, cC], 'c')
    expect(result[0].id).toBe('c')
    expect(result).toHaveLength(3)
  })
})

describe('tryWithFailover activeId（v11.7.9）', () => {
  const configs = [
    { id: 'a', name: 'First', apiKey: 'k1' },
    { id: 'b', name: 'Active', apiKey: 'k2' },
    { id: 'c', name: 'Third', apiKey: 'k3' },
  ]

  test('传入 activeId → 激活配置排到第一位被使用', async () => {
    // 所有都失败，看尝试顺序
    const order = []
    const tryFn = jest.fn(async (c) => { order.push(c.id); throw new Error('fail') })

    try { await tryWithFailover(configs, tryFn, jest.fn(), { activeId: 'b' }) } catch (_) {}

    expect(order[0]).toBe('b')  // 激活的排第一
    expect(order[1]).toBe('a')  // 然后原来的第一个
    expect(order[2]).toBe('c')  // 最后原来的第三个
  })

  test('不传 activeId → 保持原序', async () => {
    const order = []
    const tryFn = jest.fn(async (c) => { order.push(c.id); throw new Error('fail') })

    try { await tryWithFailover(configs, tryFn, jest.fn()) } catch (_) {}

    expect(order).toEqual(['a', 'b', 'c'])
  })

  test('activeId 对应的配置失败 → 继续尝试下一个', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))  // 激活的失败
      .mockResolvedValueOnce({ reply: 'from a' })  // 下一个成功

    const onSwitch = jest.fn()
    const { result } = await tryWithFailover(configs, tryFn, onSwitch, { activeId: 'b' })

    expect(result.reply).toBe('from a')
    expect(onSwitch).toHaveBeenCalledWith('Active', 'First', 'unknown')
  })

  test('不传 opts（向后兼容）', async () => {
    const tryFn = jest.fn(async () => ({ reply: 'ok' }))
    await expect(tryWithFailover(configs, tryFn)).resolves.toBeDefined()
    await expect(tryWithFailover(configs, tryFn, null)).resolves.toBeDefined()
  })
})

describe('RETRYABLE_CODES（保留向后兼容）', () => {
  test('包含所有预期的可重试码', () => {
    expect(RETRYABLE_CODES.has('E-LLM-429')).toBe(true)
    expect(RETRYABLE_CODES.has('E-LLM-500')).toBe(true)
    expect(RETRYABLE_CODES.has('E-LLM-503')).toBe(true)
    expect(RETRYABLE_CODES.has('E-NET-408')).toBe(true)
    expect(RETRYABLE_CODES.has('E-NET-500')).toBe(true)
  })

  test('集合内容不变（向后兼容）', () => {
    expect(RETRYABLE_CODES.has('E-LLM-400')).toBe(false)
    expect(RETRYABLE_CODES.has('E-LLM-401')).toBe(false)
    expect(RETRYABLE_CODES.has('E-LLM-402')).toBe(false)
    expect(RETRYABLE_CODES.has('E-LLM-403')).toBe(false)
    expect(RETRYABLE_CODES.has('E-LLM-413')).toBe(false)
  })
})
