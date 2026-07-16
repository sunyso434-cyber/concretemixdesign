const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { createError } = require('../agent/ErrorCodes')

/**
 * 学术搜索服务（砼智 v11.2.0 新增）
 *
 * 功能：
 * - 适配 Semantic Scholar / OpenAlex 两家学术搜索 API
 * - 全文尝试：Unpaywall → OpenAlex → arxiv 预印本兜底
 * - PDF 下载：老板指名时下载到 <workspace>/raw/pdf/ 并自动入知识库
 * - 复用 WebSearchService 的错误归一化模式
 *
 * 错误码说明：8 个新错误码（E-SEARCH-NO-DOI / DOI-INVALID / PAYWALLED /
 * ARXIV-RATE-LIMIT / PDF-DOWNLOAD-FAILED / PDF-TOO-LARGE / PDF-INGEST-FAILED /
 * INVALID-ACADEMIC-PROVIDER）在任务 3 集中注册到 ErrorCodes.js。
 * 本文件 createError 调用时显式传 message/hint，不依赖注册表。
 */

const SUPPORTED_PROVIDERS = ['semantic_scholar', 'openalex']
const ARXIV_MIN_INTERVAL_MS = 3000          // arxiv 限流：每 3 秒 1 次
const PDF_MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const UNPAYWALL_EMAIL = 'concrete-agent@local'  // Unpaywall 强制要求带 email
const DEFAULT_TIMEOUT = 30000
const RETRY_DELAY_MS = 5000

// URL → DOI / arxiv ID 抽取（5 种可识别模式；ScienceDirect / IEEE 等抽不到 DOI）
// DOI 后缀允许 [\w\-\.\/]+ 以兼容 Wiley (10.1002/xxx.yyyyyyy) 等含点号的 DOI
const URL_PATTERNS = [
  { test: /link\.springer\.com\/article\/(10\.\d+\/[\w\-\.\/]+)/, extract: m => m[1] },
  { test: /onlinelibrary\.wiley\.com\/doi\/(10\.\d+\/[\w\-\.\/]+)/, extract: m => m[1] },
  { test: /nature\.com\/articles\/s(\d+[\-\w]*)/, extract: m => `10.1038/s${m[1]}` },
  { test: /arxiv\.org\/(?:abs|pdf)\/([\d\.]+v?\d*)/, extract: m => ({ arxivId: m[1] }) },
  { test: /doi\.org\/(10\.\d+\/[\w\-\.\/]+)/, extract: m => m[1] }
]

// ============== PROVIDERS 适配层（search 模式） ==============
const PROVIDERS = {
  semantic_scholar: {
    url: 'https://api.semanticscholar.org/graph/v1/paper/search',
    fields: 'title,abstract,authors,year,venue,citationCount,openAccessPdf,externalIds',
    async search(query, count, timeout) {
      const res = await axios.get(this.url, {
        params: { query, limit: count, fields: this.fields },
        timeout,
        headers: { 'User-Agent': 'ConcreteAgent/11.2.0 (academic search)' }
      })
      return (res.data?.data || []).map(_mapSemanticScholar)
    }
  },
  openalex: {
    url: 'https://api.openalex.org/works',
    async search(query, count, timeout) {
      const res = await axios.get(this.url, {
        params: {
          search: query,
          per_page: count,
          select: 'id,doi,title,authorships,publication_year,primary_location,abstract_inverted_index,cited_by_count,open_access'
        },
        timeout
      })
      return (res.data?.results || []).map(_mapOpenAlex)
    }
  }
}

function _mapSemanticScholar(p) {
  return {
    title: p.title || '',
    authors: (p.authors || []).map(a => ({ name: a.name || '' })),
    year: p.year || null,
    venue: p.venue || '',
    abstract: p.abstract || '',
    doi: p.externalIds?.DOI || null,
    url: p.url || '',
    citationCount: p.citationCount || 0,
    openAccessPdf: p.openAccessPdf?.url || null,
    source: 'semantic_scholar'
  }
}

function _mapOpenAlex(p) {
  const doi = (p.doi || '').replace(/^https?:\/\/doi\.org\//, '')
  const pdfUrl = p.open_access?.oa_url
    || (p.primary_location?.source?.type === 'journal' ? p.primary_location?.pdf_url : null)
    || null
  return {
    title: (p.title || '').replace(/<[^>]+>/g, ''),
    authors: (p.authorships || [])
      .map(a => ({ name: a.author?.display_name || '' }))
      .filter(a => a.name),
    year: p.publication_year || null,
    venue: p.primary_location?.source?.display_name || '',
    abstract: invertedIndexToText(p.abstract_inverted_index),
    doi: doi || null,
    url: p.id ? `https://openalex.org/${p.id}` : '',
    citationCount: p.cited_by_count || 0,
    openAccessPdf: pdfUrl,
    source: 'openalex'
  }
}

// ============== FETCHERS 适配层（全文查找） ==============
const FETCHERS = {
  unpaywall: {
    async fetch(doi, timeout) {
      const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`
      const res = await axios.get(url, { timeout })
      const best = res.data?.best_oa_location || {}
      const pdfUrl = best.url_for_pdf
        || (best.url && /\.pdf($|\?)/.test(best.url) ? best.url : null)
      if (pdfUrl) return { available: true, source: 'unpaywall', pdfUrl }
      return { available: false, source: 'unpaywall', reason: res.data?.error || 'no_oa_copy' }
    }
  },
  openalex: {
    async fetch(doi, timeout) {
      const url = `https://api.openalex.org/works/${encodeURIComponent(doi)}?select=doi,open_access`
      const res = await axios.get(url, { timeout })
      const pdfUrl = res.data?.open_access?.oa_url || null
      if (pdfUrl) return { available: true, source: 'openalex', pdfUrl }
      return { available: false, source: 'openalex', reason: 'no_oa_copy' }
    }
  },
  arxiv: {
    async fetch(title, timeout) {
      const url = 'http://export.arxiv.org/api/query'
      const res = await axios.get(url, {
        params: { search_query: `ti:"${title.replace(/"/g, '')}"`, max_results: 3 },
        timeout,
        headers: { 'User-Agent': 'ConcreteAgent/11.2.0' }
      })
      const xml = typeof res.data === 'string' ? res.data : ''
      const entries = []
      const entryRe = /<entry>([\s\S]*?)<\/entry>/g
      let m
      while ((m = entryRe.exec(xml)) !== null) {
        const titleMatch = m[1].match(/<title>([\s\S]*?)<\/title>/)
        const idMatch = m[1].match(/<id>([\s\S]*?)<\/id>/)
        if (titleMatch && idMatch) {
          entries.push({
            title: titleMatch[1].trim().replace(/\s+/g, ' '),
            pdfUrl: idMatch[1].trim().replace(/\/abs\//, '/pdf/') + '.pdf'
          })
        }
      }
      const target = title.toLowerCase().replace(/\s+/g, '')
      let best = null
      let bestScore = 0
      for (const e of entries) {
        const score = _titleSimilarity(target, e.title.toLowerCase().replace(/\s+/g, ''))
        if (score > bestScore) { bestScore = score; best = e }
      }
      if (best && bestScore > 0.6) {
        return { available: true, source: 'arxiv', pdfUrl: best.pdfUrl, note: 'preprint' }
      }
      return { available: false, source: 'arxiv', reason: 'no_match' }
    }
  }
}

// ============== 工具函数 ==============

// OpenAlex 倒排索引 → 正常文本
function invertedIndexToText(index) {
  if (!index || typeof index !== 'object') return ''
  const positions = new Map()
  for (const [word, poss] of Object.entries(index)) {
    for (const pos of poss) positions.set(pos, word)
  }
  if (positions.size === 0) return ''
  return [...positions.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w).join(' ')
}

function _titleSimilarity(a, b) {
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.length === 0) return 1
  return (longer.length - _levenshtein(longer, shorter)) / longer.length
}

function _levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, () => [])
  for (let i = 0; i <= b.length; i++) matrix[i][0] = i
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) matrix[i][j] = matrix[i - 1][j - 1]
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[b.length][a.length]
}

// arxiv 令牌桶：每 3 秒最多 1 次
let _lastArxivCall = 0
async function _waitForArxiv() {
  const now = Date.now()
  const elapsed = now - _lastArxivCall
  if (elapsed < ARXIV_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, ARXIV_MIN_INTERVAL_MS - elapsed))
  }
  _lastArxivCall = Date.now()
}

function _extractDoiOrId(url) {
  if (!url || typeof url !== 'string') return null
  for (const p of URL_PATTERNS) {
    const m = url.match(p.test)
    if (m) return p.extract(m)
  }
  return null
}

function _sanitizeFilename(meta = {}) {
  const authorRaw = (meta.authors?.[0]?.name || 'Unknown').trim()
  const author = authorRaw.split(/\s+/).pop() || 'Unknown'
  const year = meta.year || 'unknown'
  let slug = (meta.title || 'untitled')
    .toLowerCase()
    .replace(/[?\/\\<>*|"]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
  if (!slug) slug = 'untitled'
  return `${author}_${year}_${slug}.pdf`
}

function _ensureUniqueFilename(rootDir, baseFilename) {
  const dir = path.join(rootDir, 'raw', 'pdf')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  let filename = baseFilename
  let counter = 2
  while (fs.existsSync(path.join(dir, filename))) {
    const ext = path.extname(baseFilename)
    const stem = path.basename(baseFilename, ext)
    filename = `${stem}-${counter}${ext}`
    counter++
  }
  return filename
}

const FULLTEXT_SUGGESTIONS = [
  '邮件联系作者请求 PDF（AI 可生成中英邮件模板）',
  '通过机构订阅/VPN 下载（如订阅了 Elsevier / Springer）',
  '注册 NSTL（国家科技图书文献中心）申请文献传递',
  'ResearchGate 搜索标题，部分作者自己放了 PDF',
  '查看作者个人主页 / 机构知识库'
]

// ============== 主类 ==============
class AcademicSearchService {
  /**
   * @param {object} cfg
   * @param {string} [cfg.provider] - 'semantic_scholar' | 'openalex'
   * @param {boolean} [cfg.arxivFallback] - 是否启用 arxiv 预印本兜底（默认 true）
   * @param {number} [cfg.timeout] - HTTP 超时（毫秒，默认 30000）
   * @param {object} [cfg.workspaceManager] - 由 skill 层注入，提供 current().path
   * @param {object} [cfg.wikiEngine] - 由 skill 层注入，调用 ingest({filename}) 入知识库
   */
  constructor(cfg = {}) {
    this.provider = cfg.provider || 'semantic_scholar'
    this.arxivFallback = cfg.arxivFallback !== false
    this.timeout = cfg.timeout || DEFAULT_TIMEOUT
    this.workspaceManager = cfg.workspaceManager || null
    this.wikiEngine = cfg.wikiEngine || null
  }

  /**
   * search 模式：按关键词搜索论文列表
   * @param {string} query - 搜索关键词（1-200 字）
   * @param {number} count - 返回条数 1-10（默认 5）
   */
  async search(query, count = 5) {
    if (!query || typeof query !== 'string') {
      throw createError('E-SEARCH-INVALID-QUERY', '搜索关键词无效', '请提供 1-200 字的搜索关键词')
    }
    const impl = PROVIDERS[this.provider]
    if (!impl) {
      throw createError(
        'E-SEARCH-INVALID-ACADEMIC-PROVIDER',
        '不支持的学术搜索服务商',
        `目前仅支持 ${SUPPORTED_PROVIDERS.join(' / ')}，请用 configure_academic_search 重新配置`,
        { provider: this.provider, supported: SUPPORTED_PROVIDERS }
      )
    }
    const n = parseInt(count, 10)
    const finalCount = Math.min(Math.max(Number.isNaN(n) ? 5 : n, 1), 10)
    try {
      const results = await impl.search(query, finalCount, this.timeout)
      return {
        success: true,
        mode: 'search',
        query,
        provider: this.provider,
        total: results.length,
        results
      }
    } catch (error) {
      if (error?.success === false && error?.code) throw error
      throw this._classifyError(error, 'search')
    }
  }

  /**
   * fetch 模式：拿单篇论文的全文信息（PDF URL 或付费墙提示）
   * @param {object} args
   * @param {string} [args.doi]
   * @param {string} [args.url] - 出版社 URL（自动抽 DOI）
   * @param {string} [args.title] - 论文标题（兜底走 arxiv 搜索）
   */
  async fetchFulltext({ doi, url, title } = {}) {
    let resolvedDoi = doi || null
    let arxivId = null
    if (!resolvedDoi && url) {
      const extracted = _extractDoiOrId(url)
      if (typeof extracted === 'string') {
        resolvedDoi = extracted
      } else if (extracted?.arxivId) {
        arxivId = extracted.arxivId
      } else {
        // ScienceDirect / IEEE 等 URL 无法直接转 DOI
        throw createError(
          'E-SEARCH-NO-DOI',
          'URL 中未识别到 DOI',
          '该 URL 无法直接抽 DOI（ScienceDirect / IEEE 等），请直接提供 DOI 或论文标题'
        )
      }
    }
    if (!resolvedDoi && !arxivId && !title) {
      throw createError(
        'E-SEARCH-NO-DOI',
        'URL 中未识别到 DOI',
        '请直接提供 DOI（如 10.1016/j.xxx.2024.123）或论文标题'
      )
    }

    // arxiv 直链走 arxiv 路径
    if (arxivId) {
      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`
      return {
        success: true,
        mode: 'fetch',
        arxivId,
        fulltext: { available: true, source: 'arxiv', pdfUrl, note: 'preprint' }
      }
    }

    // 主路径：Unpaywall
    try {
      const result = await FETCHERS.unpaywall.fetch(resolvedDoi, this.timeout)
      return this._formatFetchResult(resolvedDoi, result)
    } catch (unpaywallErr) {
      if (unpaywallErr?.success === false && unpaywallErr?.code?.startsWith('E-SEARCH-')) throw unpaywallErr
      // 兜底 1：OpenAlex
      try {
        const result = await FETCHERS.openalex.fetch(resolvedDoi, this.timeout)
        return this._formatFetchResult(resolvedDoi, result)
      } catch (openalexErr) {
        // 兜底 2：arxiv（仅在 arxivFallback=true 且有 title 时）
        if (!this.arxivFallback || !title) {
          throw this._classifyError(unpaywallErr, 'fetchFulltext')
        }
        try {
          await _waitForArxiv()
          const result = await FETCHERS.arxiv.fetch(title, this.timeout)
          return this._formatFetchResult(resolvedDoi, result)
        } catch (arxivErr) {
          // 全失败 → 返回付费墙结果
          return {
            success: true,
            mode: 'fetch',
            doi: resolvedDoi,
            fulltext: { available: false, source: 'none', reason: 'all_fetchers_failed', suggestions: FULLTEXT_SUGGESTIONS }
          }
        }
      }
    }
  }

  /**
   * 下载 PDF 到工作区 raw/pdf/ 并触发 ingest
   * @param {string} pdfUrl - 论文 PDF 直链
   * @param {object} paperMeta - 论文元数据（title / authors / year / fulltext）
   */
  async downloadAndIngest(pdfUrl, paperMeta = {}) {
    if (!pdfUrl) {
      throw createError('E-SEARCH-PDF-DOWNLOAD-FAILED', 'PDF URL 缺失', '无法下载，请检查论文 fulltext.available 字段')
    }

    // 1. HEAD 检查体积（>50MB 拒绝）
    let contentLength = null
    try {
      const headRes = await axios.head(pdfUrl, { timeout: this.timeout, maxRedirects: 5 })
      contentLength = parseInt(headRes.headers['content-length'], 10)
    } catch (_) { /* HEAD 失败不直接放弃，让下载阶段再判断 */ }
    if (contentLength && contentLength > PDF_MAX_SIZE_BYTES) {
      throw createError(
        'E-SEARCH-PDF-TOO-LARGE',
        'PDF 超过 50 MB',
        '大文件请用浏览器下载',
        { sizeMB: Math.round(contentLength / 1024 / 1024) }
      )
    }

    // 2. 检查工作区
    const workspaceRoot = this.workspaceManager?.current?.()?.path
    if (!workspaceRoot) {
      throw createError('E-WORKSPACE-NOT-OPEN', '工作区未打开', '请先打开工作区再下载 PDF')
    }

    // 3. 下载（重试 1 次，间隔 5 秒）
    const filename = _ensureUniqueFilename(workspaceRoot, _sanitizeFilename(paperMeta))
    const filepath = path.join(workspaceRoot, 'raw', 'pdf', filename)

    let downloadOk = false
    let lastErr = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await axios.get(pdfUrl, {
          responseType: 'stream',
          timeout: this.timeout,
          maxRedirects: 5,
          maxContentLength: PDF_MAX_SIZE_BYTES * 2
        })
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(filepath)
          res.data.pipe(ws)
          ws.on('finish', resolve)
          ws.on('error', reject)
        })
        downloadOk = true
        break
      } catch (e) {
        lastErr = e
        if (attempt < 2) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
      }
    }
    if (!downloadOk) {
      try { fs.unlinkSync(filepath) } catch (_) { /* 文件可能未创建 */ }
      throw createError(
        'E-SEARCH-PDF-DOWNLOAD-FAILED',
        'PDF 下载失败',
        '已重试 1 次仍失败，请用浏览器下载',
        { lastError: lastErr?.message }
      )
    }

    // 4. 触发 ingest（直接调 WikiEngine.ingest，避开递归 toolExecutor 栈溢出）
    const relativeFilename = `raw/pdf/${filename}`
    const source = paperMeta.fulltext?.source || 'unpaywall'
    if (this.wikiEngine) {
      try {
        const ingestResult = await this.wikiEngine.ingest({ filename: relativeFilename })
        return {
          available: true,
          source,
          pdfUrl,
          downloaded: true,
          workspaceFile: relativeFilename,
          ingested: true,
          ingestStats: ingestResult?.stats || null
        }
      } catch (ingestErr) {
        // PDF 已落盘，ingest 失败不算致命错误
        return {
          available: true,
          source,
          pdfUrl,
          downloaded: true,
          workspaceFile: relativeFilename,
          ingested: false,
          ingestError: ingestErr.message
        }
      }
    }
    // 没注入 wikiEngine（直接调用场景）
    return {
      available: true,
      source,
      pdfUrl,
      downloaded: true,
      workspaceFile: relativeFilename,
      ingested: false,
      note: '未触发 ingest（未注入 wikiEngine）'
    }
  }

  _formatFetchResult(doi, result) {
    if (result.available) {
      const fulltext = { available: true, source: result.source, pdfUrl: result.pdfUrl }
      if (result.note) fulltext.note = result.note
      return { success: true, mode: 'fetch', doi, fulltext }
    }
    return {
      success: true,
      mode: 'fetch',
      doi,
      fulltext: { available: false, source: result.source, reason: result.reason, suggestions: FULLTEXT_SUGGESTIONS }
    }
  }

  // 复用 WebSearchService 的错误归一化模式
  _classifyError(error, callSite) {
    const status = error?.response?.status
    const code = (() => {
      const httpToCode = { 400: 'E-LLM-400', 401: 'E-LLM-401', 402: 'E-LLM-402', 403: 'E-LLM-403', 413: 'E-LLM-413', 429: 'E-LLM-429', 503: 'E-LLM-503' }
      if (status && httpToCode[status]) return httpToCode[status]
      if (status && status >= 500) return 'E-LLM-500'
      if (error?.code === 'ECONNABORTED') return 'E-NET-408'
      if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET'].includes(error?.code)) return 'E-NET-500'
      return 'E-SYS-999'
    })()
    return createError(code, null, null, {
      httpStatus: status,
      provider: this.provider,
      callSite: `AcademicSearchService.${callSite}`,
      occurredAt: new Date().toISOString(),
      rawMessage: error?.message || ''
    })
  }
}

module.exports = AcademicSearchService
module.exports.SUPPORTED_PROVIDERS = SUPPORTED_PROVIDERS
module.exports.invertedIndexToText = invertedIndexToText
module.exports.sanitizeFilename = _sanitizeFilename
module.exports.extractDoiOrId = _extractDoiOrId