/**
 * v0.9.x 圆环修复：流式请求显式索要真实 token 用量（stream_options.include_usage）
 *
 * - 默认带上该参数（OpenAI 兼容标准；不带时多数网关流式不回传 usage）
 * - 老网关不认识该参数报 400/422 且错误体提到 stream_options → 自动去掉参数重试一次
 * - 普通 400（与该参数无关）→ 不重试，走原有错误路径
 */
jest.mock('axios', () => ({ post: jest.fn() }))
const axios = require('axios')
const { EventEmitter } = require('events')
const DeepSeekService = require('../../services/DeepSeekService')

const makeService = () => {
  const systemService = {
    getAgentConfig: jest.fn(async () => ({ apiKey: 'k', baseUrl: 'http://x', model: 'm' })),
    getActiveLlmConfig: jest.fn()
  }
  return new DeepSeekService({ apiKey: 'k' }, systemService)
}

/** 构造一个可手动驱动事件的假 SSE 流 */
const makeStream = () => {
  const stream = new EventEmitter()
  stream.destroyed = false
  return stream
}

describe('chatWithToolsStream 索要真实用量（v0.9.x 圆环修复）', () => {
  beforeEach(() => jest.clearAllMocks())

  test('默认携带 stream_options.include_usage，且末尾 chunk 的 usage 被透出', async () => {
    const stream = makeStream()
    axios.post.mockResolvedValueOnce({ data: stream })
    const svc = makeService()

    const p = svc.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], () => {})
    await new Promise(res => setImmediate(res))

    // 第一次请求带上了 stream_options
    expect(axios.post).toHaveBeenCalledTimes(1)
    const body = axios.post.mock.calls[0][1]
    expect(body.stream_options).toEqual({ include_usage: true })

    // 模拟网关在最后一个 chunk 回传 usage
    stream.emit('data', Buffer.from('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":123,"completion_tokens":7}}\n\n'))
    stream.emit('end')

    const final = await p
    expect(final.usage).toEqual({ prompt_tokens: 123, completion_tokens: 7 })
  })

  test('网关拒绝 stream_options（400 且错误体提及）→ 去掉参数自动重试一次', async () => {
    const stream = makeStream()
    const rejectErr = Object.assign(new Error('Bad Request'), {
      response: {
        status: 400,
        data: '{"error":{"message":"Unknown parameter: stream_options"}}'
      }
    })
    axios.post
      .mockRejectedValueOnce(rejectErr)   // 带参数被拒
      .mockResolvedValueOnce({ data: stream })  // 去参后成功
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const svc = makeService()

    const p = svc.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], () => {})
    await new Promise(res => setImmediate(res))
    stream.emit('end')
    const final = await p

    expect(final.content).toBe('')
    expect(axios.post).toHaveBeenCalledTimes(2)
    // 重试的请求体不再含 stream_options
    expect(axios.post.mock.calls[1][1].stream_options).toBeUndefined()
    warnSpy.mockRestore()
  })

  test('与 stream_options 无关的 400 → 不重试，直接走错误分类路径', async () => {
    const rejectErr = Object.assign(new Error('Bad Request'), {
      response: { status: 400, data: '{"error":{"message":"invalid api key format"}}' }
    })
    axios.post.mockRejectedValue(rejectErr)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const svc = makeService()

    // 外层会把原始错误包装成结构化错误（E-LLM-400），关键是：只调用一次，未去参重试
    await expect(svc.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], () => {}))
      .rejects.toMatchObject({ code: 'E-LLM-400' })

    expect(axios.post).toHaveBeenCalledTimes(1)
    errSpy.mockRestore()
  })

  test('响应头前用户中断 → 不触发去参重试，静默抛 AbortError', async () => {
    const abortErr = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', name: 'CanceledError' })
    axios.post.mockRejectedValueOnce(abortErr)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const svc = makeService()

    await expect(svc.chatWithToolsStream(
      [{ role: 'user', content: 'hi' }], [], () => {}, new AbortController().signal
    )).rejects.toMatchObject({ name: 'AbortError', code: 'ERR_CANCELED' })

    expect(axios.post).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })
})
