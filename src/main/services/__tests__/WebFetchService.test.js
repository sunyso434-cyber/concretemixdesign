// src/main/services/__tests__/WebFetchService.test.js
// WebFetchService 单测：重点验证限速器行为、URL/format 校验、429 错误处理
const axios = require('axios')
const WebFetchService = require('../WebFetchService')

// Mock axios
jest.mock('axios')
const mockedAxios = axios

// 模块级单例 helper
const svc = () => new WebFetchService({ timeout: 1000 })

describe('WebFetchService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset()
    WebFetchService._resetRateLimiterForTest()
  })

  // ============== URL 校验 ==============
  test('空 URL → E-SEARCH-INVALID-QUERY', async () => {
    await expect(svc().fetch('')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    await expect(svc().fetch(null)).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    await expect(svc().fetch(undefined)).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('非 http(s):// 开头 → E-SEARCH-INVALID-QUERY', async () => {
    await expect(svc().fetch('ftp://x.com')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    await expect(svc().fetch('example.com/page')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    await expect(svc().fetch('www.example.com')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('URL 超长 → E-SEARCH-INVALID-QUERY', async () => {
    const longUrl = 'https://x.com/' + 'a'.repeat(2100)
    await expect(svc().fetch(longUrl)).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('URL 前后空白会被 trim', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '# 标题\n正文' })
    const r = await svc().fetch('  https://example.com/page  ')
    expect(r.success).toBe(true)
    expect(r.url).toBe('https://example.com/page')
    // 验证实际请求 URL 用的是 trim 后的
    const calledUrl = mockedAxios.get.mock.calls[0][0]
    expect(calledUrl).toBe('https://r.jina.ai/https://example.com/page')
  })

  // ============== format 校验 ==============
  test('非法 format → E-SEARCH-INVALID-QUERY', async () => {
    await expect(svc().fetch('https://x.com', { format: 'pdf' }))
      .rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    await expect(svc().fetch('https://x.com', { format: 'xml' }))
      .rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  // ============== 限速器（核心：老板强调的点） ==============
  describe('令牌桶限速', () => {
    beforeEach(() => {
      // 用真实 timer，但 mock axios 立即 resolve，让等待时间真实可见
      mockedAxios.get.mockResolvedValue({ data: '# T\ncontent' })
    })

    test('首次调用不等待（_lastJinaCall=0 时立即执行）', async () => {
      const start = Date.now()
      await svc().fetch('https://a.com')
      const elapsed = Date.now() - start
      // 没有等待（允许少量事件循环开销）
      expect(elapsed).toBeLessThan(500)
      // 限速器被更新
      expect(WebFetchService._getJinaLimiterStateForTest()).toBeGreaterThan(0)
    })

    test('第二次调用必须等待至少 MIN_INTERVAL_MS', async () => {
      WebFetchService._resetRateLimiterForTest()
      // 第一次：立即完成
      await svc().fetch('https://a.com')
      const firstDoneAt = Date.now()

      // 第二次：必须等到 firstDoneAt + MIN_INTERVAL_MS
      const start2 = Date.now()
      await svc().fetch('https://b.com')
      const elapsed2 = Date.now() - start2
      const gap = Date.now() - firstDoneAt

      // 第二次至少等了 (MIN_INTERVAL - 事件循环开销)
      expect(elapsed2).toBeGreaterThanOrEqual(WebFetchService.MIN_INTERVAL_MS - 200)
      expect(gap).toBeGreaterThanOrEqual(WebFetchService.MIN_INTERVAL_MS - 200)
    })

    test('并发调用被串行化（两个并发 fetch 不会同时落到 Jina）', async () => {
      WebFetchService._resetRateLimiterForTest()
      const start = Date.now()
      // 同时发起两个
      await Promise.all([
        svc().fetch('https://a.com'),
        svc().fetch('https://b.com')
      ])
      const elapsed = Date.now() - start
      // 第二个必须等第一个 + MIN_INTERVAL，所以总耗时 >= MIN_INTERVAL
      expect(elapsed).toBeGreaterThanOrEqual(WebFetchService.MIN_INTERVAL_MS - 200)
    })

    test('所有实例共享同一个限速器', async () => {
      WebFetchService._resetRateLimiterForTest()
      // 两个不同的 service 实例
      const s1 = new WebFetchService()
      const s2 = new WebFetchService()
      await s1.fetch('https://a.com')
      const start2 = Date.now()
      await s2.fetch('https://b.com')
      const elapsed2 = Date.now() - start2
      // 不同实例也受同一个限速器约束
      expect(elapsed2).toBeGreaterThanOrEqual(WebFetchService.MIN_INTERVAL_MS - 200)
    })
  })

  // ============== 正常返回 ==============
  test('markdown 模式：从 # 标题提取 title', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '# 混凝土配合比设计规范\n\n## 1 范围\n正文内容' })
    const r = await svc().fetch('https://example.com/spec')
    expect(r.success).toBe(true)
    expect(r.format).toBe('markdown')
    expect(r.title).toBe('混凝土配合比设计规范')
    expect(r.content).toContain('范围')
    expect(r.url).toBe('https://example.com/spec')
  })

  test('markdown 模式：无 # 标题时 title 为空', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '正文无标题' })
    const r = await svc().fetch('https://example.com')
    expect(r.title).toBe('')
    expect(r.content).toBe('正文无标题')
  })

  test('json 模式：返回 {title, content, url} 结构化', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { title: 'JSON Title', content: 'JSON 内容', url: 'https://example.com' }
    })
    const r = await svc().fetch('https://example.com', { format: 'json' })
    expect(r.success).toBe(true)
    expect(r.format).toBe('json')
    expect(r.title).toBe('JSON Title')
    expect(r.content).toBe('JSON 内容')
    // 验证请求头里 Accept 是 application/json
    const opts = mockedAxios.get.mock.calls[0][1]
    expect(opts.headers.Accept).toBe('application/json')
    expect(opts.responseType).toBe('json')
  })

  test('html 模式：Accept=text/html', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '<html>...</html>' })
    await svc().fetch('https://example.com', { format: 'html' })
    const opts = mockedAxios.get.mock.calls[0][1]
    expect(opts.headers.Accept).toBe('text/html')
    expect(opts.responseType).toBe('text')
  })

  test('text 模式：透传 X-Return-Format=text 头', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: 'plain text' })
    await svc().fetch('https://example.com', { format: 'text' })
    const opts = mockedAxios.get.mock.calls[0][1]
    expect(opts.headers['X-Return-Format']).toBe('text')
    expect(opts.headers.Accept).toBe('text/plain')
  })

  test('selector 透传到 X-Target-Selector 头', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '正文' })
    await svc().fetch('https://example.com', { selector: 'article.main' })
    const opts = mockedAxios.get.mock.calls[0][1]
    expect(opts.headers['X-Target-Selector']).toBe('article.main')
  })

  test('默认 format 是 markdown', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '' })
    const r = await svc().fetch('https://example.com')
    expect(r.format).toBe('markdown')
    const opts = mockedAxios.get.mock.calls[0][1]
    expect(opts.headers.Accept).toBe('text/plain')
  })

  // ============== 错误分类 ==============
  test('429 → E-LLM-429 + Jina 限流提示', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 429, data: 'rate limit' } })
    await expect(svc().fetch('https://x.com')).rejects.toMatchObject({
      code: 'E-LLM-429',
      hint: expect.stringContaining('Jina 免费层限流')
    })
  })

  test('401 → E-LLM-401', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 401 } })
    await expect(svc().fetch('https://x.com')).rejects.toMatchObject({ code: 'E-LLM-401' })
  })

  test('500 → E-LLM-500', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 500 } })
    await expect(svc().fetch('https://x.com')).rejects.toMatchObject({ code: 'E-LLM-500' })
  })

  test('网络超时 → E-NET-408 + Jina 代理提示', async () => {
    mockedAxios.get.mockRejectedValueOnce({ code: 'ECONNABORTED' })
    await expect(svc().fetch('https://x.com')).rejects.toMatchObject({
      code: 'E-NET-408',
      hint: expect.stringContaining('Jina Reader')
    })
  })

  test('DNS/连接失败 → E-NET-500 + Jina 代理提示', async () => {
    mockedAxios.get.mockRejectedValueOnce({ code: 'ENOTFOUND' })
    await expect(svc().fetch('https://x.com')).rejects.toMatchObject({
      code: 'E-NET-500',
      hint: expect.stringContaining('Jina Reader')
    })
  })

  test('ETIMEDOUT → E-NET-500 + Jina 代理提示（真实场景）', async () => {
    // 老板反馈的真实错误：baidu.com 和 jina.ai 都 ETIMEDOUT
    mockedAxios.get.mockRejectedValueOnce({ code: 'ETIMEDOUT' })
    await expect(svc().fetch('https://r.jina.ai/https://www.baidu.com')).rejects.toMatchObject({
      code: 'E-NET-500',
      hint: expect.stringContaining('全局代理')
    })
  })

  test('未知错误 → E-SYS-999', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('something weird'))
    await expect(svc().fetch('https://x.com')).rejects.toMatchObject({ code: 'E-SYS-999' })
  })

  test('createError 抛出的标准错误透传不二次包装', async () => {
    // URL 校验抛的是 createError，应原样抛出（不被 _classifyError 二次处理）
    // 这里通过非 http URL 触发
    await expect(svc().fetch('not-a-url')).rejects.toMatchObject({
      code: 'E-SEARCH-INVALID-QUERY',
      title: 'URL 格式无效'
    })
  })

  test('错误 details 包含 callSite=WebFetchService.fetch', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 500 } })
    try {
      await svc().fetch('https://x.com')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.details.callSite).toBe('WebFetchService.fetch')
      expect(e.details.httpStatus).toBe(500)
    }
  })
})

// ============== Skill 层入口测试 ==============
describe('web_fetch skill', () => {
  const skills = require('../../skills/web-fetch')
  const skill = skills.find(s => s.name === 'web_fetch')

  test('skill 元数据正确', () => {
    expect(skill).toBeDefined()
    expect(skill.name).toBe('web_fetch')
    expect(skill.description).toContain('Jina')
    expect(skill.parameters.url.required).toBe(true)
    expect(skill.parameters.format.required).toBe(false)
    expect(skill.parameters.selector.required).toBe(false)
  })

  test('空 url → errorCode E-SEARCH-INVALID-QUERY', async () => {
    const r = await skill.execute({ url: '' }, {})
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
  })

  test('非 http(s):// url → errorCode', async () => {
    const r = await skill.execute({ url: 'ftp://x.com' }, {})
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
  })

  test('非法 format → errorCode', async () => {
    const r = await skill.execute({ url: 'https://x.com', format: 'pdf' }, {})
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
  })

  test('服务抛标准错误 → 透传 errorCode', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 429 } })
    WebFetchService._resetRateLimiterForTest()
    const r = await skill.execute({ url: 'https://x.com' }, {})
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-LLM-429')
    expect(r.hint).toContain('Jina 免费层限流')
  })

  test('成功路径：返回正文', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '# 标题\n正文' })
    WebFetchService._resetRateLimiterForTest()
    const r = await skill.execute({ url: 'https://example.com' }, {})
    expect(r.success).toBe(true)
    expect(r.title).toBe('标题')
    expect(r.content).toContain('正文')
  })
})
