const axios = require('axios')
const { createError } = require('../agent/ErrorCodes')

/**
 * 网页正文抓取服务（砼智 v0.0.9 新增，v0.8.x 加 tinyfish provider）
 *
 * 支持两个 provider：
 * - jina（默认，无 key 免费层）：基于 Jina Reader (https://r.jina.ai)，约 20 RPM
 * - tinyfish（需 key，与 web_search 的 tinyfish key 共用）：POST api.fetch.tinyfish.ai，150 URL/分钟
 *
 * 设计要点：
 * - 模块级令牌桶：仅约束 jina（_lastJinaCall），防止并发突破 Jina 免费层限速
 * - 4 种返回格式：markdown（默认）/ json / html / text
 *   注：tinyfish 原生不支持 text，text 请求会被映射为 markdown
 * - selector 参数：jina 透传 X-Target-Selector 头；tinyfish 映射为 include_selectors 数组
 * - 错误归一化复用 WebSearchService 模式；429/网络错误按 provider 给不同 hint
 */

const JINA_BASE = 'https://r.jina.ai'
const TINYFISH_URL = 'https://api.fetch.tinyfish.ai'
const MIN_INTERVAL_MS = 3000          // Jina 免费层约 20 RPM，每 3 秒 1 次（仅约束 jina）
const DEFAULT_TIMEOUT = 60000         // 两者都走浏览器渲染，给 60 秒
const MAX_URL_LENGTH = 2048
const VALID_FORMATS = ['markdown', 'json', 'html', 'text']
const SUPPORTED_PROVIDERS = ['jina', 'tinyfish']

// 模块级令牌桶：仅约束 jina，所有 WebFetchService 实例共享
// tinyfish 限速 150 URL/分钟，远比 jina 宽裕，不加令牌桶
let _lastJinaCall = 0

async function _waitForJinaSlot() {
  const now = Date.now()
  const elapsed = now - _lastJinaCall
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  _lastJinaCall = Date.now()
}

// 暴露给单测：重置限速状态
function _resetRateLimiterForTest() {
  _lastJinaCall = 0
}

class WebFetchService {
  /**
   * @param {object} [cfg]
   * @param {string} [cfg.provider='jina'] - jina | tinyfish
   * @param {string} [cfg.apiKey] - tinyfish 必填（与 web_search 共用）；jina 不需要
   * @param {number} [cfg.timeout] - HTTP 超时（毫秒，默认 60000）
   */
  constructor(cfg = {}) {
    this.provider = cfg.provider || 'jina'
    this.apiKey = cfg.apiKey
    this.timeout = cfg.timeout || DEFAULT_TIMEOUT
  }

  /**
   * 抓取单页正文
   * @param {string} url - 目标 URL，必须 http(s):// 开头
   * @param {object} [opts]
   * @param {string} [opts.format] - markdown|json|html|text，默认 markdown
   * @param {string} [opts.selector] - CSS 选择器，只抓页面某块
   * @returns {Promise<{success, url, title, content, format}>}
   */
  async fetch(url, opts = {}) {
    // 1. 校验 URL
    if (!url || typeof url !== 'string') {
      throw createError('E-SEARCH-INVALID-QUERY', 'URL 不能为空', '请提供 http(s):// 开头的网址')
    }
    const trimmed = url.trim()
    if (!/^https?:\/\//i.test(trimmed)) {
      throw createError(
        'E-SEARCH-INVALID-QUERY',
        'URL 格式无效',
        '请提供 http(s):// 开头的完整网址',
        { received: trimmed }
      )
    }
    if (trimmed.length > MAX_URL_LENGTH) {
      throw createError(
        'E-SEARCH-INVALID-QUERY',
        `URL 过长（>${MAX_URL_LENGTH} 字符）`,
        '请缩短 URL'
      )
    }

    // 2. 校验 format
    const format = opts.format || 'markdown'
    if (!VALID_FORMATS.includes(format)) {
      throw createError(
        'E-SEARCH-INVALID-QUERY',
        `不支持的 format: ${format}`,
        `仅支持 ${VALID_FORMATS.join(' / ')}`,
        { received: format, supported: VALID_FORMATS }
      )
    }

    // 3. 按 provider 分发
    if (!SUPPORTED_PROVIDERS.includes(this.provider)) {
      throw createError(
        'E-SEARCH-INVALID-PROVIDER',
        `不支持的抓取服务商: ${this.provider}`,
        `仅支持 ${SUPPORTED_PROVIDERS.join(' / ')}`,
        { received: this.provider, supported: SUPPORTED_PROVIDERS }
      )
    }
    if (this.provider === 'tinyfish') {
      return this._fetchTinyfish(trimmed, format, opts)
    }
    return this._fetchJina(trimmed, format, opts)
  }

  /**
   * Jina Reader 抓取（无 key 免费模式）
   * Jina Reader 按 Accept 头决定返回格式：
   *   text/plain        → markdown（默认）
   *   application/json  → {url, title, content} 结构化
   *   text/html         → 原始 HTML
   *   text/plain + X-Return-Format: text → 纯文本
   */
  async _fetchJina(url, format, opts) {
    // 限速：等待令牌桶放行
    await _waitForJinaSlot()

    const accept = format === 'json'
      ? 'application/json'
      : format === 'html'
        ? 'text/html'
        : 'text/plain'

    const headers = {
      'Accept': accept,
      'User-Agent': 'ConcreteAgent/0.1.0 (web_fetch; jina reader free tier)'
    }
    if (format === 'text') {
      headers['X-Return-Format'] = 'text'
    }
    if (opts.selector) {
      headers['X-Target-Selector'] = opts.selector
    }

    const targetUrl = `${JINA_BASE}/${url}`
    try {
      const res = await axios.get(targetUrl, {
        headers,
        timeout: this.timeout,
        maxRedirects: 5,
        responseType: format === 'json' ? 'json' : 'text'
      })

      if (format === 'json') {
        return {
          success: true,
          url,
          title: res.data?.title || '',
          content: res.data?.content || '',
          format
        }
      }
      // markdown / html / text：Jina 直接返回文本
      const content = typeof res.data === 'string' ? res.data : ''
      let title = ''
      if (format === 'markdown') {
        const m = content.match(/^#\s+(.+)$/m)
        if (m) title = m[1].trim()
      }
      return {
        success: true,
        url,
        title,
        content,
        format
      }
    } catch (error) {
      if (error && error.success === false && error.code) throw error
      throw this._classifyError(error)
    }
  }

  /**
   * TinyFish Fetch 抓取（需 key，与 web_search 共用）
   * POST api.fetch.tinyfish.ai，body: {urls:[url], format, include_selectors?}
   * 返回 {results: [{url, title, text, ...}], errors: [...]}
   * 注：tinyfish 不支持 text 格式，text 请求映射为 markdown
   */
  async _fetchTinyfish(url, format, opts) {
    if (!this.apiKey) {
      throw createError(
        'E-SEARCH-NOT-CONFIGURED',
        'tinyfish 抓取未配置 API key',
        '请先说「配置联网搜索，服务商 tinyfish，api key 是 xxx」调用 configure_web_search',
        { hint: 'configure_web_search' }
      )
    }

    // tinyfish 原生 format: markdown | html | json（无 text）
    const tfFormat = format === 'text' ? 'markdown' : format
    const body = {
      urls: [url],
      format: tfFormat
    }
    if (opts.selector) {
      body.include_selectors = [opts.selector]
    }

    try {
      const res = await axios.post(TINYFISH_URL, body, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout,
        maxRedirects: 5,
        responseType: 'json'
      })

      // tinyfish 返回 {results: [...], errors: [...]}
      const result = (res.data?.results || [])[0]
      const errItem = (res.data?.errors || [])[0]
      if (errItem && !result) {
        // 该 URL 抓取失败（timeout/bot_blocked/empty_content 等）
        throw createError(
          'E-SEARCH-FETCH-FAILED',
          `tinyfish 抓取失败: ${errItem.code || 'unknown'}`,
          this._tinyfishErrorHint(errItem.code),
          { url, tfCode: errItem.code }
        )
      }
      if (!result) {
        throw createError(
          'E-SEARCH-FETCH-FAILED',
          'tinyfish 返回空结果',
          '该 URL 可能无法访问或无正文内容',
          { url }
        )
      }

      // text 模式：实际用 markdown 抓取，但对调用方仍报 format=text
      return {
        success: true,
        url,
        title: result.title || '',
        content: result.text || '',
        format
      }
    } catch (error) {
      if (error && error.success === false && error.code) throw error
      throw this._classifyError(error)
    }
  }

  /**
   * tinyfish 业务错误码（非 HTTP）的可读提示
   */
  _tinyfishErrorHint(code) {
    const m = {
      timeout: '页面未在超时前加载完成，可稍后重试或换一个 URL',
      bot_blocked: '目标站点有反爬保护（Cloudflare 等），tinyfish 无法抓取',
      empty_content: '页面渲染后无可提取正文，可能是 SPA 空壳页'
    }
    return m[code] || undefined
  }

  /**
   * 错误归一化：复用 WebSearchService 模式，429/网络错误按 provider 给不同 hint
   */
  _classifyError(error) {
    const status = error?.response?.status
    const code = (() => {
      const httpToCode = {
        400: 'E-LLM-400', 401: 'E-LLM-401', 402: 'E-LLM-402',
        403: 'E-LLM-403', 413: 'E-LLM-413', 429: 'E-LLM-429', 503: 'E-LLM-503'
      }
      if (status && httpToCode[status]) return httpToCode[status]
      if (status && status >= 500) return 'E-LLM-500'
      if (error?.code === 'ECONNABORTED') return 'E-NET-408'
      if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET'].includes(error?.code)) {
        return 'E-NET-500'
      }
      return 'E-SYS-999'
    })()

    // hint 按 provider 区分：jina/tinyfish 都是国外服务，国内需全局代理
    const hint = (() => {
      if (status === 429) {
        return this.provider === 'tinyfish'
          ? 'tinyfish 限流（免费层 150 URL/分钟），请稍后重试或减少批量抓取'
          : 'Jina 免费层限流（约 20 RPM），请等 1 分钟后再试，或减少批量抓取'
      }
      if (code === 'E-NET-408' || code === 'E-NET-500') {
        const svc = this.provider === 'tinyfish' ? 'TinyFish (api.fetch.tinyfish.ai)' : 'Jina Reader (r.jina.ai)'
        return `web_fetch 依赖国外服务 ${svc}，国内网络需开启全局代理或 TUN 模式才能访问。可临时改用 web_search 查看摘要。`
      }
      return undefined
    })()

    const rawMessage = (() => {
      if (error?.response?.data?.error?.message) return error.response.data.error.message
      if (error?.response?.data?.message) return error.response.data.message
      const data = error?.response?.data
      if (data) {
        if (typeof data === 'string') return data
        try { return JSON.stringify(data).slice(0, 500) } catch (_) { /* ignore */ }
      }
      return error?.message || ''
    })()

    return createError(code, null, hint, {
      httpStatus: status,
      provider: this.provider,
      callSite: 'WebFetchService.fetch',
      occurredAt: new Date().toISOString(),
      rawMessage
    })
  }
}

module.exports = WebFetchService
module.exports.JINA_BASE = JINA_BASE
module.exports.TINYFISH_URL = TINYFISH_URL
module.exports.MIN_INTERVAL_MS = MIN_INTERVAL_MS
module.exports.VALID_FORMATS = VALID_FORMATS
module.exports.MAX_URL_LENGTH = MAX_URL_LENGTH
module.exports.SUPPORTED_PROVIDERS = SUPPORTED_PROVIDERS
module.exports._resetRateLimiterForTest = _resetRateLimiterForTest
module.exports._getJinaLimiterStateForTest = () => _lastJinaCall
