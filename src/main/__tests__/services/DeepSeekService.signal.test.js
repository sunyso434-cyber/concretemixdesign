jest.mock('axios', () => ({ post: jest.fn() }))
const axios = require('axios')
const DeepSeekService = require('../../services/DeepSeekService')

const makeService = () => {
  const systemService = { getAgentConfig: jest.fn(async () => ({ apiKey: 'k', baseUrl: 'http://x', model: 'm' })), getActiveLlmConfig: jest.fn() }
  return new DeepSeekService({ apiKey: 'k' }, systemService)
}

describe('DeepSeekService signal 断流（v3.1）', () => {
  beforeEach(() => jest.clearAllMocks())

  test('响应头前 abort：post 抛 ERR_CANCELED → 静默抛 AbortError，不打 HTTP 错误日志', async () => {
    const err = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', name: 'CanceledError' })
    axios.post.mockRejectedValueOnce(err)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const svc = makeService()
    await expect(svc.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], () => {}, new AbortController().signal))
      .rejects.toMatchObject({ name: 'AbortError', code: 'ERR_CANCELED' })
    // 不打「💥 流式 HTTP」错误日志（abort 是正常中断）
    expect(consoleSpy.mock.calls.some(c => String(c[0]).includes('流式 HTTP'))).toBe(false)
    consoleSpy.mockRestore()
  })

  test('流式中 abort：axios post resolve 后 stream error 触发 reject（走现有路径）', async () => {
    // 构造一个会 emit error 的假 stream
    const { EventEmitter } = require('events')
    const stream = new EventEmitter()
    stream.destroyed = false
    axios.post.mockResolvedValueOnce({ data: stream })
    const svc = makeService()
    const p = svc.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], () => {})
    // 等 async 链挂上 stream 监听（getConfig → axios.post resolve 都是微任务），否则 emit('error') 无监听器会抛 Unhandled error
    await new Promise(res => setImmediate(res))
    const err = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', name: 'CanceledError' })
    stream.emit('error', err)
    await expect(p).rejects.toMatchObject({ name: 'AbortError', code: 'ERR_CANCELED' })
  })
})
