const VisionService = require('../../services/VisionService')
const axios = require('axios')

jest.mock('axios')

describe('VisionService', () => {
  let service

  beforeEach(() => {
    service = new VisionService({
      apiUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'qwen-vl-plus',
      maxDimension: 1024,
      maxSizeMb: 10
    })
    jest.clearAllMocks()
  })

  test('成功调用视觉 API 返回文本', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: '裂缝宽约0.3mm' } }]
      }
    })
    const result = await service.analyze({
      base64: 'data:image/jpeg;base64,/9j/...',
      systemPrompt: '你是视觉分析助手',
      userPrompt: '请描述这张图'
    })
    expect(result.content).toBe('裂缝宽约0.3mm')
    expect(axios.post).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({
        model: 'qwen-vl-plus',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' })
        ])
      }),
      expect.any(Object)
    )
  })

  test('HTTP 401 抛出 E-LLM-401 错误', async () => {
    const axiosErr = new Error('Request failed')
    axiosErr.response = { status: 401, data: { error: { message: 'invalid api key' } } }
    axios.post.mockRejectedValue(axiosErr)
    await expect(service.analyze({ base64: 'data:image/jpeg;base64,xxx' }))
      .rejects.toMatchObject({ code: 'E-LLM-401' })
  })

  test('HTTP 429 抛出 E-LLM-429 错误', async () => {
    const axiosErr = new Error('rate limited')
    axiosErr.response = { status: 429, data: { error: { message: 'rate limit' } } }
    axios.post.mockRejectedValue(axiosErr)
    await expect(service.analyze({ base64: 'data:image/jpeg;base64,xxx' }))
      .rejects.toMatchObject({ code: 'E-LLM-429' })
  })

  test('网络错误抛出 E-NET-500', async () => {
    const axiosErr = new Error('connect refused')
    axiosErr.code = 'ECONNREFUSED'
    axios.post.mockRejectedValue(axiosErr)
    await expect(service.analyze({ base64: 'data:image/jpeg;base64,xxx' }))
      .rejects.toMatchObject({ code: 'E-NET-500' })
  })

  test('未传 base64 抛出 E-SYS-999', async () => {
    await expect(service.analyze({}))
      .rejects.toMatchObject({ code: 'E-SYS-999' })
  })
})
