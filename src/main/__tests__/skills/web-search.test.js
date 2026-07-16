// Mock WebSearchService — web_search 技能内部 new WebSearchService(cfg) 走到 mock
const mockSearch = jest.fn()
jest.mock('../../services/WebSearchService', () => {
  return jest.fn(function MockWebSearchService() {
    this.search = mockSearch
  })
})

const WebSearchService = require('../../services/WebSearchService')
const skills = require('../../skills/web-search')

const getSkill = () => skills.find(s => s.name === 'web_search')

describe('web_search 技能', () => {
  let mockSystemService

  beforeEach(() => {
    WebSearchService.mockClear()
    mockSearch.mockReset()
    mockSystemService = {
      getWebSearchConfig: jest.fn().mockResolvedValue({ enabled: true, provider: 'bocha', apiKey: 'sk-test' })
    }
  })

  test('query 为空 → E-SEARCH-INVALID-QUERY', async () => {
    const r = await getSkill().execute({ query: '   ' }, { systemService: mockSystemService })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
    expect(WebSearchService).not.toHaveBeenCalled()
  })

  test('query 超 200 字 → E-SEARCH-INVALID-QUERY', async () => {
    const r = await getSkill().execute({ query: 'a'.repeat(201) }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
  })

  test('未配置（enabled=false）→ E-SEARCH-NOT-CONFIGURED', async () => {
    mockSystemService.getWebSearchConfig.mockResolvedValue({ enabled: false, provider: 'bocha', apiKey: '' })
    const r = await getSkill().execute({ query: 'C30' }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('E-SEARCH-NOT-CONFIGURED')
    expect(r.hint).toContain('configure_web_search')
    expect(WebSearchService).not.toHaveBeenCalled()
  })

  test('已配置但无 key → E-SEARCH-NOT-CONFIGURED', async () => {
    mockSystemService.getWebSearchConfig.mockResolvedValue({ enabled: true, provider: 'bocha', apiKey: null })
    const r = await getSkill().execute({ query: 'C30' }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('E-SEARCH-NOT-CONFIGURED')
  })

  test('正常搜索返回结果列表', async () => {
    mockSearch.mockResolvedValue([{ title: 'T', url: 'https://t.com', snippet: 's', source: 'bocha' }])
    const r = await getSkill().execute({ query: 'GB/T 50081', count: 3 }, { systemService: mockSystemService })
    expect(r.success).toBe(true)
    expect(r.total).toBe(1)
    expect(r.provider).toBe('bocha')
    expect(mockSearch).toHaveBeenCalledWith('GB/T 50081', 3)
  })

  test('搜索服务抛标准错误 → 透传 errorCode', async () => {
    mockSearch.mockRejectedValue({ success: false, code: 'E-LLM-429', title: '频率超限' })
    const r = await getSkill().execute({ query: 'q' }, { systemService: mockSystemService })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-LLM-429')
  })

  test('systemService 缺失 → E-SYS-999', async () => {
    const r = await getSkill().execute({ query: 'q' }, {})
    expect(r.errorCode).toBe('E-SYS-999')
  })
})
