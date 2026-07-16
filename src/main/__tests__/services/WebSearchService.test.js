// Mock axios — WebSearchService 内部 axios.post 走到 mock
jest.mock('axios')
const axios = require('axios')
const WebSearchService = require('../../services/WebSearchService')

describe('WebSearchService', () => {
  beforeEach(() => {
    axios.post.mockReset()
  })

  test('bocha 正常返回，映射为 {title,url,snippet,source}', async () => {
    axios.post.mockResolvedValue({
      data: { data: { webPages: { value: [
        { name: '标题A', url: 'https://a.com', summary: '长摘要A' },
        { name: '标题B', url: 'https://b.com', snippet: '片段B' }
      ] } } }
    })
    const svc = new WebSearchService({ provider: 'bocha', apiKey: 'sk-x' })
    const results = await svc.search('C30 配合比', 5)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ title: '标题A', url: 'https://a.com', snippet: '长摘要A', source: 'bocha' })
    expect(results[1].snippet).toBe('片段B') // 无 summary 时回退 snippet
  })

  test('tavily 正常返回，content 映射为 snippet', async () => {
    axios.post.mockResolvedValue({ data: { results: [{ title: 'T', url: 'https://t.com', content: '正文T' }] } })
    const svc = new WebSearchService({ provider: 'tavily', apiKey: 'tvly-x' })
    const results = await svc.search('规范', 3)
    expect(results[0]).toEqual({ title: 'T', url: 'https://t.com', snippet: '正文T', source: 'tavily' })
  })

  test('count 越界被 clamp 到 1-10', async () => {
    axios.post.mockResolvedValue({ data: { data: { webPages: { value: [] } } } })
    const svc = new WebSearchService({ provider: 'bocha', apiKey: 'sk-x' })
    await svc.search('q', 100)
    expect(axios.post.mock.calls[0][1].count).toBe(10)
    await svc.search('q', 0)
    expect(axios.post.mock.calls[1][1].count).toBe(1)
  })

  test('不支持的 provider 抛 E-SEARCH-INVALID-PROVIDER', async () => {
    const svc = new WebSearchService({ provider: 'google', apiKey: 'x' })
    await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-PROVIDER', success: false })
    expect(axios.post).not.toHaveBeenCalled()
  })

  test('返回空结果 → []', async () => {
    axios.post.mockResolvedValue({ data: {} })
    const svc = new WebSearchService({ provider: 'bocha', apiKey: 'sk-x' })
    expect(await svc.search('q')).toEqual([])
  })

  test('401 → E-LLM-401', async () => {
    axios.post.mockRejectedValue({ response: { status: 401 } })
    const svc = new WebSearchService({ provider: 'bocha', apiKey: 'bad' })
    await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-LLM-401' })
  })

  test('429 → E-LLM-429（配额耗尽）', async () => {
    axios.post.mockRejectedValue({ response: { status: 429 } })
    const svc = new WebSearchService({ provider: 'bocha', apiKey: 'x' })
    await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-LLM-429' })
  })

  test('超时 ECONNABORTED → E-NET-408', async () => {
    axios.post.mockRejectedValue({ code: 'ECONNABORTED' })
    const svc = new WebSearchService({ provider: 'bocha', apiKey: 'x' })
    await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-NET-408' })
  })

  test('断网 ECONNREFUSED → E-NET-500', async () => {
    axios.post.mockRejectedValue({ code: 'ECONNREFUSED' })
    const svc = new WebSearchService({ provider: 'tavily', apiKey: 'x' })
    await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-NET-500' })
  })
})
