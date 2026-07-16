// Mock axios — AcademicSearchService 内部 axios.get/.head 走到 mock
jest.mock('axios')
const axios = require('axios')
const AcademicSearchService = require('../../services/AcademicSearchService')
const { invertedIndexToText, sanitizeFilename, extractDoiOrId } = AcademicSearchService

describe('AcademicSearchService', () => {
  beforeEach(() => {
    axios.get.mockReset()
    axios.head.mockReset()
  })

  // ===== invertedIndexToText（spec 验收用例 #2）=====
  describe('invertedIndexToText', () => {
    test('OpenAlex 倒排索引还原成正常文本（含同词多次）', () => {
      const idx = { 'frost': [12, 28], 'resistance': [13], 'of': [10, 25] }
      expect(invertedIndexToText(idx)).toBe('of frost resistance of frost')
    })
    test('中文倒排索引还原', () => {
      const idx = { '混凝土': [0, 5], '抗冻': [2] }
      expect(invertedIndexToText(idx)).toBe('混凝土 抗冻 混凝土')
    })
    test('空索引 → 空字符串', () => {
      expect(invertedIndexToText(null)).toBe('')
      expect(invertedIndexToText({})).toBe('')
      expect(invertedIndexToText(undefined)).toBe('')
    })
  })

  // ===== sanitizeFilename（spec 验收用例 #24）=====
  describe('sanitizeFilename', () => {
    test('特殊字符 ?/\\<>*|" 替换为 -，连续 - 合并', () => {
      const fn = sanitizeFilename({ title: 'C50? 混凝土 / 抗冻性', authors: [{ name: 'Zhang San' }], year: 2024 })
      expect(fn).toBe('San_2024_c50-混凝土-抗冻性.pdf')
    })
    test('中文标题保留', () => {
      const fn = sanitizeFilename({ title: '混凝土抗冻性研究', authors: [{ name: 'Li Si' }], year: 2023 })
      expect(fn).toBe('Si_2023_混凝土抗冻性研究.pdf')
    })
    test('标题为空时用 untitled 兜底', () => {
      const fn = sanitizeFilename({ year: 2024 })
      expect(fn).toContain('untitled')
      expect(fn).toMatch(/\.pdf$/)
    })
    test('作者名缺失时用 Unknown 兜底', () => {
      const fn = sanitizeFilename({ title: 'X', year: 2024 })
      expect(fn).toContain('Unknown')
    })
    test('超过 100 字符的 slug 被截断', () => {
      const longTitle = 'a'.repeat(150)
      const fn = sanitizeFilename({ title: longTitle, year: 2024 })
      // stem 部分应 < 100 字符
      expect(fn.length).toBeLessThan(120)
    })
  })

  // ===== extractDoiOrId（spec 验收用例 #5/#6/#7）=====
  describe('extractDoiOrId', () => {
    test('Springer URL → DOI', () => {
      expect(extractDoiOrId('https://link.springer.com/article/10.1007/s00170-024-13579-y'))
        .toBe('10.1007/s00170-024-13579-y')
    })
    test('Wiley URL → DOI（含点号）', () => {
      expect(extractDoiOrId('https://onlinelibrary.wiley.com/doi/10.1002/adfm.202401234'))
        .toBe('10.1002/adfm.202401234')
    })
    test('Nature URL → DOI', () => {
      expect(extractDoiOrId('https://www.nature.com/articles/s41586-024-12345-6'))
        .toBe('10.1038/s41586-024-12345-6')
    })
    test('arxiv URL → arxivId 对象', () => {
      expect(extractDoiOrId('https://arxiv.org/abs/2401.12345'))
        .toEqual({ arxivId: '2401.12345' })
    })
    test('doi.org URL → DOI', () => {
      expect(extractDoiOrId('https://doi.org/10.1016/j.conbuildmat.2024.123456'))
        .toBe('10.1016/j.conbuildmat.2024.123456')
    })
    test('ScienceDirect URL → null（无法直接转 DOI）', () => {
      expect(extractDoiOrId('https://www.sciencedirect.com/science/article/pii/S0950061824001234'))
        .toBeNull()
    })
    test('IEEE URL → null（无法直接转 DOI）', () => {
      expect(extractDoiOrId('https://ieeexplore.ieee.org/document/1234567')).toBeNull()
    })
    test('非 URL 字符串 → null', () => {
      expect(extractDoiOrId('not a url')).toBeNull()
    })
  })

  // ===== search（spec 验收用例 #1/#9/#10/#11）=====
  describe('search', () => {
    test('semantic_scholar 搜索：字段映射正确', async () => {
      axios.get.mockResolvedValue({
        data: { data: [
          { title: 'C50 frost', abstract: 'abs', authors: [{ name: 'A1' }], year: 2024, venue: 'CBM', citationCount: 10, openAccessPdf: { url: 'https://pdf.com/1.pdf' }, externalIds: { DOI: '10.123/test' } }
        ] }
      })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('C50 frost', 5)
      expect(r.success).toBe(true)
      expect(r.mode).toBe('search')
      expect(r.provider).toBe('semantic_scholar')
      expect(r.results).toHaveLength(1)
      expect(r.results[0]).toMatchObject({
        title: 'C50 frost',
        abstract: 'abs',
        year: 2024,
        venue: 'CBM',
        doi: '10.123/test',
        openAccessPdf: 'https://pdf.com/1.pdf',
        citationCount: 10,
        source: 'semantic_scholar'
      })
      expect(r.results[0].authors).toEqual([{ name: 'A1' }])
    })

    test('openalex 搜索：倒排索引还原 + 字段映射', async () => {
      axios.get.mockResolvedValue({
        data: { results: [{
          id: 'W123', doi: 'https://doi.org/10.123/oa', title: 'OA paper', authorships: [{ author: { display_name: 'O1' } }],
          publication_year: 2023, primary_location: { source: { display_name: 'Journal X', type: 'journal' } },
          abstract_inverted_index: { frost: [0] }, cited_by_count: 5, open_access: { oa_url: 'https://oa.com/1.pdf' }
        }] }
      })
      const svc = new AcademicSearchService({ provider: 'openalex' })
      const r = await svc.search('frost', 5)
      expect(r.results[0].abstract).toBe('frost')
      expect(r.results[0].doi).toBe('10.123/oa')
      expect(r.results[0].openAccessPdf).toBe('https://oa.com/1.pdf')
      expect(r.results[0].source).toBe('openalex')
    })

    test('搜索 0 结果 → total: 0', async () => {
      axios.get.mockResolvedValue({ data: { data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('nonexistent', 5)
      expect(r.total).toBe(0)
      expect(r.results).toEqual([])
    })

    test('count 越界被 clamp 到 1-10', async () => {
      axios.get.mockResolvedValue({ data: { data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await svc.search('q', 100)
      expect(axios.get.mock.calls[0][1].params.limit).toBe(10)
      await svc.search('q', 0)
      expect(axios.get.mock.calls[1][1].params.limit).toBe(1)
    })

    test('不支持的 provider → E-SEARCH-INVALID-ACADEMIC-PROVIDER', async () => {
      const svc = new AcademicSearchService({ provider: 'baidu' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-ACADEMIC-PROVIDER', success: false })
      expect(axios.get).not.toHaveBeenCalled()
    })

    test('空 query → E-SEARCH-INVALID-QUERY', async () => {
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.search('')).rejects.toMatchObject({ code: 'E-SEARCH-INVALID-QUERY' })
    })

    test('HTTP 500 → E-LLM-500', async () => {
      axios.get.mockRejectedValue({ response: { status: 500 } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-LLM-500' })
    })

    test('超时 ECONNABORTED → E-NET-408', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNABORTED' })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-NET-408' })
    })

    test('断网 ECONNREFUSED → E-NET-500', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' })
      const svc = new AcademicSearchService({ provider: 'openalex' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-NET-500' })
    })
  })

  // ===== fetchFulltext（spec 验收用例 #3/#4/#8）=====
  describe('fetchFulltext', () => {
    test('Unpaywall OA 命中 → fulltext.available=true', async () => {
      axios.get.mockResolvedValue({
        data: { best_oa_location: { url_for_pdf: 'https://pdf.com/oa.pdf' } }
      })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.fetchFulltext({ doi: '10.123/oa' })
      expect(r.fulltext.available).toBe(true)
      expect(r.fulltext.source).toBe('unpaywall')
      expect(r.fulltext.pdfUrl).toBe('https://pdf.com/oa.pdf')
    })

    test('Unpaywall 付费墙 → fulltext.available=false + 5 条建议', async () => {
      axios.get.mockResolvedValue({ data: { best_oa_location: null } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.fetchFulltext({ doi: '10.123/paywall' })
      expect(r.fulltext.available).toBe(false)
      expect(r.fulltext.suggestions).toHaveLength(5)
    })

    test('arxiv URL 直接返回 arxiv 全文（不走 Unpaywall）', async () => {
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.fetchFulltext({ url: 'https://arxiv.org/abs/2401.12345' })
      expect(r.fulltext.available).toBe(true)
      expect(r.fulltext.source).toBe('arxiv')
      expect(r.fulltext.pdfUrl).toBe('https://arxiv.org/pdf/2401.12345.pdf')
      expect(r.fulltext.note).toBe('preprint')
      expect(axios.get).not.toHaveBeenCalled()  // arxiv 直链不发 HTTP
    })

    test('ScienceDirect URL → E-SEARCH-NO-DOI', async () => {
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.fetchFulltext({ url: 'https://www.sciencedirect.com/science/article/pii/S123' }))
        .rejects.toMatchObject({ code: 'E-SEARCH-NO-DOI' })
    })

    test('未传 doi/url/title → E-SEARCH-NO-DOI', async () => {
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.fetchFulltext({})).rejects.toMatchObject({ code: 'E-SEARCH-NO-DOI' })
    })
  })
})