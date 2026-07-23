const axios = require('axios')
const { createError } = require('../agent/ErrorCodes')

/**
 * 网页正文抓取服务（砼智 v11.8.4 新增）
 *
 * 基于 Jina Reader (https://r.jina.ai)，无 API key 模式，复用 Jina 免费层。
 *
 * 设计要点：
 * - 模块级令牌桶：所有实例共享 _lastJinaCall，防止并发突破 Jina 免费层限速（约 20 RPM）
 * - 4 种返回格式：markdown（默认）/ json / html / text
 * - 支持 selector 参数（透传 X-Target-Selector 头，只抓页面某块）
 * - 错误归一化复用 WebSearchService 模式；429 单独给提示
 *
 * 与 WebSearchService 的关系：
 * - WebSearchService 负责「搜」：返回 {title, url, snippet} 列表
 * - WebFetchService  负责「读」：抓单 URL 正文，给 LLM 喂全文
 * 二者组合 = DeepSearch 的「搜索-阅读」闭环基础
 */

const JINA_BASE = 'https://r.jina.ai'
const MIN_INTERVAL_MS = 3000          // Jina 免费层约 20 RPM，每 3 秒 1 次
const DEFAULT_TIMEOUT = 60000         // Jina 走浏览器渲染，给 60 秒
const MAX_URL_LENGTH = 2048
const VALID_FORMATS = ['markdown', 'json', 'html', 'text']

// 模块级令牌桶：所有 WebFetchService 实例共享，防止并发突破限速
// 与 AcademicSearchService._waitForArxiv 同套路
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
   * @param {number} [cfg.timeout] - HTTP 超时（毫秒，默认 60000）
   */
  constructor(cfg = {}) {
    this.timeout = cfg.timeout || DEFAULT_TIMEOUT
  }

  /**
   * 抓取单页正文
   * @param {string} url - 目标 URL，必须 http(s):// 开头
   * @param {object} [opts]
   * @param {string} [opts.format] - markdown|json|html|text，默认 markdown
   * @param {string} [opts.selector] - CSS 选择器，只抓页面某块（透传给 Jina 的 X-Target-Selector）
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

    // 3. 限速：等待令牌桶放行
    await _waitForJinaSlot()

    // 4. 构造请求头
    // Jina Reader 按 Accept 头决定返回格式：
    //   text/plain        → markdown（默认）
    //   application/json  → {url, title, content} 结构化
    //   text/html         → 原始 HTML
    //   text/plain + X-Return-Format: text → 纯文本
    const accept = format === 'json'
      ? 'application/json'
      : format === 'html'
        ? 'text/html'
        : 'text/plain'

    const headers = {
      'Accept': accept,
      'User-Agent': 'ConcreteAgent/11.8.4 (web_fetch; jina reader free tier)'
    }
    if (format === 'text') {
      headers['X-Return-Format'] = 'text'
    }
    if (opts.selector) {
      headers['X-Target-Selector'] = opts.selector
    }

    // 5. 发请求
    const targetUrl = `${JINA_BASE}/${trimmed}`
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
          url: trimmed,
          title: res.data?.title || '',
          content: res.data?.content || '',
          format
        }
      }
      // markdown / html / text：Jina 直接返回文本
      const content = typeof res.data === 'string' ? res.data : ''
      // 尝试从 markdown 内容里提一个粗略标题（第一行的 # 标题），方便上层展示
      let title = ''
      if (format === 'markdown') {
        const m = content.match(/^#\s+(.+)$/m)
        if (m) title = m[1].trim()
      }
      return {
        success: true,
        url: trimmed,
        title,
        content,
        format
      }
    } catch (error) {
      // 已是标准错误（如 createError 抛出的），直接透传
      if (error && error.success === false && error.code) throw error
      throw this._classifyError(error)
    }
  }

  /**
   * 错误归一化：复用 WebSearchService 模式，429 单独给提示
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

    // Jina 免费层 429：给老板/LLM 一个明确的恢复提示
    // 网络类错误（E-NET-*）：r.jina.ai 是国外服务，国内网络需全局代理/TUN 模式
    const hint = (() => {
      if (status === 429) {
        return 'Jina 免费层限流（约 20 RPM），请等 1 分钟后再试，或减少批量抓取'
      }
      if (code === 'E-NET-408' || code === 'E-NET-500') {
        return 'web_fetch 依赖国外服务 Jina Reader (r.jina.ai)，国内网络需开启全局代理或 TUN 模式才能访问。可临时改用 web_search 查看摘要。'
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
      callSite: 'WebFetchService.fetch',
      occurredAt: new Date().toISOString(),
      rawMessage
    })
  }
}

module.exports = WebFetchService
module.exports.JINA_BASE = JINA_BASE
module.exports.MIN_INTERVAL_MS = MIN_INTERVAL_MS
module.exports.VALID_FORMATS = VALID_FORMATS
module.exports.MAX_URL_LENGTH = MAX_URL_LENGTH
module.exports._resetRateLimiterForTest = _resetRateLimiterForTest
module.exports._getJinaLimiterStateForTest = () => _lastJinaCall
