const { tryWithFailover } = require('../../services/llmFailover')

describe('tryWithFailover shouldStopOnError（v3.1 要点 2）', () => {
  test('shouldStopOnError 返回 true → 直接穿透，不尝试下一个配置', async () => {
    const tryFn = jest.fn().mockRejectedValue({ name: 'AbortError', message: 'interrupted', code: 'ERR_CANCELED' })
    const onSwitch = jest.fn()
    await expect(
      tryWithFailover(
        [{ apiKey: 'k1', name: 'A' }, { apiKey: 'k2', name: 'B' }],
        tryFn, onSwitch,
        { shouldStopOnError: (err) => err?.name === 'AbortError' || err?.code === 'ERR_CANCELED' }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(tryFn).toHaveBeenCalledTimes(1)   // 只试了第一个，没切到第二个
    expect(onSwitch).not.toHaveBeenCalled()
  })

  test('shouldStopOnError 返回 false → 走现有切换逻辑', async () => {
    const tryFn = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')
    const { result } = await tryWithFailover(
      [{ apiKey: 'k1', name: 'A' }, { apiKey: 'k2', name: 'B' }],
      tryFn, jest.fn(),
      { shouldStopOnError: () => false }
    )
    expect(tryFn).toHaveBeenCalledTimes(2)
    expect(result).toBe('ok')
  })

  test('不传 shouldStopOnError → 行为不变', async () => {
    const tryFn = jest.fn().mockRejectedValue(new Error('boom'))
    await expect(tryWithFailover([{ apiKey: 'k1', name: 'A' }, { apiKey: 'k2', name: 'B' }], tryFn, jest.fn()))
      .rejects.toThrow('boom')
    expect(tryFn).toHaveBeenCalledTimes(2)
  })
})
