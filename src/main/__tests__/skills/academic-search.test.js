// Mock AcademicSearchService — academic_search 技能内部 new AcademicSearchService() 走到 mock
const mockSearch = jest.fn()
const mockFetch = jest.fn()
const mockDownload = jest.fn()
jest.mock('../../services/AcademicSearchService', () => {
  return jest.fn(function MockAcademicSearchService() {
    this.search = mockSearch
    this.fetchFulltext = mockFetch
    this.downloadAndIngest = mockDownload
  })
})
const AcademicSearchService = require('../../services/AcademicSearchService')
const skills = require('../../skills/academic-search')

const getSkill = () => skills.find(s => s.name === 'academic_search')

describe('academic_search 技能', () => {
  let mockSystemService, mockWiki

  beforeEach(() => {
    AcademicSearchService.mockClear()
    mockSearch.mockReset()
    mockFetch.mockReset()
    mockDownload.mockReset()
    mockSystemService = {
      getAcademicSearchConfig: jest.fn().mockResolvedValue({ provider: 'semantic_scholar', arxivFallback: true })
    }
    // skill 通过 global 拿 workspaceManager / wikiEngine（与 workspaceTools 同款模式）
    global.workspaceManager = { current: () => ({ path: '/tmp/test-ws' }) }
    mockWiki = { ingest: jest.fn().mockResolvedValue({ stats: { pages: 12, chars: 8521 } }) }
    global.wikiEngine = mockWiki
  })

  afterEach(() => {
    delete global.workspaceManager
    delete global.wikiEngine
  })

  // ===== 参数校验 =====
  test('mode 缺失 → PARAM_INVALID_FORMAT', async () => {
    const r = await getSkill().execute({}, { systemService: mockSystemService })
    expect(r.errorCode).toBe('PARAM_INVALID_FORMAT')
  })

  test('mode 非法值 → PARAM_INVALID_FORMAT', async () => {
    const r = await getSkill().execute({ mode: 'find' }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('PARAM_INVALID_FORMAT')
  })

  test('systemService 缺失 → E-SYS-999', async () => {
    const r = await getSkill().execute({ mode: 'search', query: 'q' }, {})
    expect(r.errorCode).toBe('E-SYS-999')
  })

  // ===== search 模式 =====
  test('search 模式：query 为空 → E-SEARCH-INVALID-QUERY', async () => {
    const r = await getSkill().execute({ mode: 'search', query: '   ' }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
  })

  test('search 模式：query > 200 字 → E-SEARCH-INVALID-QUERY', async () => {
    const r = await getSkill().execute({ mode: 'search', query: 'a'.repeat(201) }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('E-SEARCH-INVALID-QUERY')
  })

  test('search 模式：正常调用 → 返回结果', async () => {
    mockSearch.mockResolvedValue({ success: true, mode: 'search', total: 1, results: [{ title: 'A' }] })
    const r = await getSkill().execute({ mode: 'search', query: 'C50', count: 3 }, { systemService: mockSystemService })
    expect(r.success).toBe(true)
    expect(mockSearch).toHaveBeenCalledWith('C50', 3)
    expect(AcademicSearchService).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'semantic_scholar',
      arxivFallback: true
    }))
  })

  test('search 模式：配置走 openalex → 传给 service', async () => {
    mockSystemService.getAcademicSearchConfig.mockResolvedValue({ provider: 'openalex', arxivFallback: false })
    mockSearch.mockResolvedValue({ success: true, mode: 'search', total: 0, results: [] })
    await getSkill().execute({ mode: 'search', query: 'q' }, { systemService: mockSystemService })
    expect(AcademicSearchService).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openalex',
      arxivFallback: false
    }))
  })

  // ===== fetch 模式 =====
  test('fetch 模式：未传任何参数 → E-SEARCH-NO-DOI', async () => {
    const r = await getSkill().execute({ mode: 'fetch' }, { systemService: mockSystemService })
    expect(r.errorCode).toBe('E-SEARCH-NO-DOI')
  })

  test('fetch 模式：normal → 返回 fulltext，但不下载', async () => {
    mockFetch.mockResolvedValue({ success: true, mode: 'fetch', fulltext: { available: true, pdfUrl: 'https://pdf.com/1.pdf' } })
    const r = await getSkill().execute({ mode: 'fetch', doi: '10.123/oa' }, { systemService: mockSystemService })
    expect(r.fulltext.available).toBe(true)
    expect(mockDownload).not.toHaveBeenCalled()
  })

  test('fetch 模式：download=true + OA → 触发下载并合并 fulltext', async () => {
    mockFetch.mockResolvedValue({
      success: true, mode: 'fetch', doi: '10.123/oa',
      title: 'Paper X', authors: [{ name: 'A1' }], year: 2024,
      fulltext: { available: true, pdfUrl: 'https://pdf.com/1.pdf', source: 'unpaywall' }
    })
    mockDownload.mockResolvedValue({
      available: true, source: 'unpaywall', pdfUrl: 'https://pdf.com/1.pdf',
      downloaded: true, workspaceFile: 'raw/pdf/A1_2024_paper-x.pdf', ingested: true
    })
    const r = await getSkill().execute({ mode: 'fetch', doi: '10.123/oa', download: true }, { systemService: mockSystemService })
    expect(r.fulltext.downloaded).toBe(true)
    expect(r.fulltext.ingested).toBe(true)
    expect(mockDownload).toHaveBeenCalledWith('https://pdf.com/1.pdf', expect.objectContaining({
      title: 'Paper X',
      authors: [{ name: 'A1' }],
      year: 2024
    }))
  })

  test('fetch 模式：download=true 但 fulltext.available=false → 不下载', async () => {
    mockFetch.mockResolvedValue({
      success: true, mode: 'fetch', doi: '10.123/paywall',
      fulltext: { available: false, source: 'unpaywall', suggestions: ['建议 1'] }
    })
    const r = await getSkill().execute({ mode: 'fetch', doi: '10.123/paywall', download: true }, { systemService: mockSystemService })
    expect(r.fulltext.available).toBe(false)
    expect(r.fulltext.suggestions).toEqual(['建议 1'])
    expect(mockDownload).not.toHaveBeenCalled()
  })

  test('service 抛标准错误 → 透传 errorCode', async () => {
    mockFetch.mockRejectedValue({ success: false, code: 'E-SEARCH-NO-DOI', title: 'no DOI' })
    const r = await getSkill().execute({ mode: 'fetch', url: 'https://sciencedirect.com/xxx' }, { systemService: mockSystemService })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('E-SEARCH-NO-DOI')
  })
})