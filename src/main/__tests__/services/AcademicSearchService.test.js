// Mock axios — AcademicSearchService 内部 axios.get/.head/.post 走到 mock
jest.mock('axios')
const axios = require('axios')
const AcademicSearchService = require('../../services/AcademicSearchService')
const { invertedIndexToText, sanitizeFilename, extractDoiOrId } = AcademicSearchService

describe('AcademicSearchService', () => {
  beforeEach(() => {
    axios.get.mockReset()
    axios.head.mockReset()
    axios.post.mockReset()
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

    // ===== nstl provider 测试（真实接口结构：[{f,v}] 数组）=====
    test('nstl 搜索：[{f,v}] 数组结构正确映射为标准 schema', async () => {
      // 列表接口返回：data 是二维数组，每篇是 [{f,v}]
      // 详情接口返回：data 是一维数组 [{f,v}]
      axios.post.mockImplementation((url) => {
        if (url.includes('paper/pc/list/pl')) {
          return Promise.resolve({
            data: {
              code: '0', total: 1,
              data: [[
                { f: 'id', v: 'abc123' },
                { f: 'type', v: 'JournalPaper' },
                { f: 'score', v: 138 }
              ]]
            }
          })
        }
        if (url.includes('paper/pc/detail')) {
          return Promise.resolve({
            data: {
              code: 0, total: 1,
              data: [
                { f: 'id', v: 'abc123' },
                { f: 'tit', v: ['喷射混凝土早期强度研究'] },
                { f: 'yea', v: ['2026'] },
                { f: 'abs', v: ['本文研究喷射混凝土早期强度发展规律...'] },
                { f: 'doi', v: ['10.13726/j.cnki.11-2706/tq.2026.04.380.03'] },
                { f: 'hasAut', v: [[{ f: 'id', v: '2f635ac7' }, { f: 'type', v: 'People' }, { f: 'nam', v: ['丁永庆'] }]] },
                { f: 'hasSo', v: [[{ f: 'id', v: 'qmfskz' }, { f: 'type', v: 'Source' }, { f: 'tit', v: ['全面腐蚀控制'] }]] }
              ]
            }
          })
        }
        return Promise.reject(new Error('unexpected url ' + url))
      })
      const svc = new AcademicSearchService({ provider: 'nstl' })
      const r = await svc.search('混凝土早期强度', 5)
      expect(r.success).toBe(true)
      expect(r.provider).toBe('nstl')
      expect(r.results).toHaveLength(1)
      const p = r.results[0]
      expect(p.title).toBe('喷射混凝土早期强度研究')
      expect(p.abstract).toBe('本文研究喷射混凝土早期强度发展规律...')
      expect(p.year).toBe(2026)
      expect(p.doi).toBe('10.13726/j.cnki.11-2706/tq.2026.04.380.03')
      expect(p.venue).toBe('全面腐蚀控制')
      expect(p.source).toBe('nstl')
      expect(p.citationCount).toBe(0)
      expect(p.openAccessPdf).toBeNull()
      expect(p.url).toContain('paper_detail.html?id=abc123')
      expect(p.authors).toEqual([{ name: '丁永庆' }])
    })

    test('nstl 搜索：多作者场景（二维数组多元素）', async () => {
      // nstl 是 fallback 链第一个，其他 provider mock 成空，确保只走 nstl
      axios.get.mockResolvedValue({ data: { data: [] } })  // semantic_scholar/openalex 返回空
      axios.post.mockImplementation((url) => {
        if (url.includes('paper/pc/list/pl')) {
          return Promise.resolve({ data: { code: '0', total: 1, data: [[{ f: 'id', v: 'multi-id' }]] } })
        }
        if (url.includes('paper/pc/detail')) {
          return Promise.resolve({
            data: { code: 0, data: [
              { f: 'id', v: 'multi-id' },
              { f: 'tit', v: ['合著论文'] },
              { f: 'abs', v: ['摘要内容'] },
              { f: 'hasAut', v: [
                [{ f: 'id', v: 'a1' }, { f: 'type', v: 'People' }, { f: 'nam', v: ['张三'] }],
                [{ f: 'id', v: 'a2' }, { f: 'type', v: 'People' }, { f: 'nam', v: ['李四'] }],
                [{ f: 'id', v: 'a3' }, { f: 'type', v: 'People' }, { f: 'nam', v: ['王五'] }]
              ] }
            ] }
          })
        }
        return Promise.reject(new Error('unexpected'))
      })
      const svc = new AcademicSearchService({ provider: 'nstl' })
      const r = await svc.search('合著', 5)
      expect(r.provider).toBe('nstl')
      expect(r.results[0].authors).toEqual([
        { name: '张三' }, { name: '李四' }, { name: '王五' }
      ])
    })

    test('nstl 搜索：列表返回空数组 → 0 结果', async () => {
      // 所有 provider 都返回空
      axios.get.mockResolvedValue({ data: { data: [] } })
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } })
      const svc = new AcademicSearchService({ provider: 'nstl' })
      const r = await svc.search('不存在的关键词', 5)
      expect(r.total).toBe(0)
      expect(r.results).toEqual([])
    })

    test('nstl 搜索：详情接口单篇失败不影响其他篇', async () => {
      // 列表返回 2 个 id，其中第二个详情接口失败
      let detailCallCount = 0
      axios.post.mockImplementation((url) => {
        if (url.includes('paper/pc/list/pl')) {
          return Promise.resolve({
            data: { code: '0', total: 2, data: [
              [{ f: 'id', v: 'ok-id' }],
              [{ f: 'id', v: 'fail-id' }]
            ] }
          })
        }
        if (url.includes('paper/pc/detail')) {
          detailCallCount++
          // 第 1 次详情调用成功，第 2 次失败
          if (detailCallCount === 1) {
            return Promise.resolve({
              data: { code: 0, data: [
                { f: 'id', v: 'ok-id' },
                { f: 'tit', v: ['成功篇'] },
                { f: 'abs', v: ['摘要'] }
              ] }
            })
          }
          return Promise.reject(new Error('connection timeout'))
        }
        return Promise.reject(new Error('unexpected'))
      })
      const svc = new AcademicSearchService({ provider: 'nstl' })
      const r = await svc.search('测试', 5)
      // 失败篇被 .catch 吞掉，成功篇正常返回
      expect(r.results.length).toBeGreaterThanOrEqual(1)
      expect(r.results.find(p => p.title === '成功篇')).toBeTruthy()
    })

    test('搜索 0 结果 → total: 0', async () => {
      // 所有 provider 都返回空（fallback 后仍 0 结果）
      axios.get.mockResolvedValue({ data: { data: [] } })
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('nonexistent', 5)
      expect(r.total).toBe(0)
      expect(r.results).toEqual([])
    })

    test('count 越界被 clamp 到 1-10', async () => {
      // 所有 provider 返回空，避免 fallback 干扰
      axios.get.mockResolvedValue({ data: { data: [] } })
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      // count=100 → clamp 到 10
      await svc.search('q', 100)
      const ssCalls = axios.get.mock.calls.filter(c => c[0]?.includes('semanticscholar'))
      expect(ssCalls[0][1].params.limit).toBe(10)
      // count=0 → clamp 到 1（重置 mock 后再测）
      axios.get.mockClear()
      await svc.search('q', 0)
      const ssCalls2 = axios.get.mock.calls.filter(c => c[0]?.includes('semanticscholar'))
      expect(ssCalls2[0][1].params.limit).toBe(1)
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

    test('HTTP 500 → E-LLM-500（所有 provider 都 500 才抛）', async () => {
      axios.get.mockRejectedValue({ response: { status: 500 } })
      axios.post.mockRejectedValue({ response: { status: 500 } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-LLM-500' })
    })

    test('超时 ECONNABORTED → E-NET-408（所有 provider 都超时才抛）', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNABORTED' })
      axios.post.mockRejectedValue({ code: 'ECONNABORTED' })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-NET-408' })
    })

    test('断网 ECONNREFUSED → E-NET-500（所有 provider 都断网才抛）', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' })
      axios.post.mockRejectedValue({ code: 'ECONNREFUSED' })
      const svc = new AcademicSearchService({ provider: 'openalex' })
      await expect(svc.search('q')).rejects.toMatchObject({ code: 'E-NET-500' })
    })

    // ===== fallback 路由测试 =====
    test('fallback：主 provider 0 结果 → 自动跳下一个 provider 命中', async () => {
      // semantic_scholar 返回空，openalex 返回有结果
      let callCount = 0
      axios.get.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // semantic_scholar 第一次调用返回空
          return Promise.resolve({ data: { data: [] } })
        }
        // openalex 返回有结果
        return Promise.resolve({ data: { results: [{
          id: 'W1', doi: 'https://doi.org/10.1/fb', title: 'Fallback 命中',
          authorships: [{ author: { display_name: 'A' } }], publication_year: 2024,
          primary_location: { source: { display_name: 'J', type: 'journal' } },
          abstract_inverted_index: { frost: [0] }, cited_by_count: 0, open_access: {}
        }] } })
      })
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } }) // nstl 不应被调到
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('q', 5)
      expect(r.provider).toBe('openalex')   // 实际命中 openalex
      expect(r.fallbackUsed).toBe(true)      // 触发了 fallback
      expect(r.providersTried).toEqual(['semantic_scholar', 'openalex'])
      expect(r.results[0].title).toBe('Fallback 命中')
    })

    test('fallback：主 provider 报错 → 自动跳下一个 provider 命中', async () => {
      // semantic_scholar 报 500，openalex 命中
      let callCount = 0
      axios.get.mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject({ response: { status: 500 } })
        return Promise.resolve({ data: { results: [{
          id: 'W2', title: '错误后命中', authorships: [], publication_year: 2024,
          primary_location: {}, abstract_inverted_index: { x: [0] }, cited_by_count: 0, open_access: {}
        }] } })
      })
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('q', 5)
      expect(r.provider).toBe('openalex')
      expect(r.fallbackUsed).toBe(true)
      expect(r.results[0].title).toBe('错误后命中')
    })

    test('fallback：摘要全空（置信度低）→ 自动跳下一个', async () => {
      // semantic_scholar 返回结果但摘要全空
      axios.get.mockImplementation(() => Promise.resolve({ data: { data: [
        { title: '无摘要论文', abstract: '', authors: [], year: 2024, venue: '', citationCount: 0, openAccessPdf: null, externalIds: {} }
      ] } }))
      // openalex 命中（有摘要）
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('q', 5)
      // semantic_scholar 摘要全空 → 跳 openalex（也空）→ 跳 nstl（也空）→ 最终空结果
      expect(r.success).toBe(true)
      expect(r.total).toBe(0)
      expect(r.providersTried).toHaveLength(3)  // 三个都试了
    })

    // ===== BUG 重现：中文查询应优先 nstl，却被 openalex 挡住 =====
    test('BUG 修复验证：中文查询用户选 semantic_scholar → 先试用户选的，无效后 fallback 到 nstl（而非 openalex）', async () => {
      // semantic_scholar 查中文返回空（用户选择无效）
      axios.get.mockImplementation((url) => {
        if (url.includes('semanticscholar')) {
          return Promise.resolve({ data: { data: [] } })
        }
        // openalex 对中文返回了结果（有英文摘要）—— 修复后不应被调到（nstl 优先）
        if (url.includes('openalex')) {
          return Promise.resolve({ data: { results: [{
            id: 'W1', title: 'Some English paper', authorships: [],
            publication_year: 2024, primary_location: {},
            abstract_inverted_index: { concrete: [0] }, cited_by_count: 0, open_access: {}
          }] } })
        }
        return Promise.resolve({ data: { data: [] } })
      })
      // nstl 有中文结果
      axios.post.mockImplementation((url) => {
        if (url.includes('paper/pc/list/pl')) {
          return Promise.resolve({ data: { code: '0', total: 1, data: [[{ f: 'id', v: 'nstl-id' }]] } })
        }
        if (url.includes('paper/pc/detail')) {
          return Promise.resolve({ data: { code: 0, data: [
            { f: 'id', v: 'nstl-id' },
            { f: 'tit', v: ['喷射混凝土早期强度研究'] },
            { f: 'abs', v: ['中文摘要内容'] }
          ] } })
        }
        return Promise.reject(new Error('unexpected'))
      })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('混凝土早期强度', 5)
      // 用户选的 semantic_scholar 先试（返回空 → 无效）→ fallback 到 nstl（而非 openalex）
      expect(r.provider).toBe('nstl')
      expect(r.fallbackUsed).toBe(true)
      expect(r.providersTried).toEqual(['semantic_scholar', 'nstl'])
      // openalex 不应被调到（nstl 已命中）
      expect(r.providersTried).not.toContain('openalex')
    })

    test('路由优先级：英文查询用户选 semantic_scholar → 用户选的直接命中，不走 fallback', async () => {
      // semantic_scholar 英文查询命中
      axios.get.mockResolvedValue({ data: { data: [
        { title: 'English Paper', abstract: 'Some abstract', authors: [], year: 2024, venue: '', citationCount: 0, openAccessPdf: null, externalIds: {} }
      ] } })
      axios.post.mockResolvedValue({ data: { code: '0', total: 0, data: [] } })
      const svc = new AcademicSearchService({ provider: 'semantic_scholar' })
      const r = await svc.search('concrete strength', 5)
      // 用户选的 semantic_scholar 直接命中，不走 fallback
      expect(r.provider).toBe('semantic_scholar')
      expect(r.fallbackUsed).toBe(false)
      expect(r.providersTried).toEqual(['semantic_scholar'])
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