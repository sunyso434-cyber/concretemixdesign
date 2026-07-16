const axios = require('axios')
const { createError } = require('../agent/ErrorCodes')

/**
 * 联网搜索服务
 * - 各家搜索 API 接口/返回格式不同，用适配层统一成 {title, url, snippet, source}
 * - 加一家新服务商 = 在 PROVIDERS 里加一个块
 * - 错误分类复用视觉的 HTTP→错误码映射
 */

const PROVIDERS = {
  // 博查：国内免费源（新用户可领 1000 次），summary:true 返回长摘要
  bocha: {
    url: 'https://api.bochaai.com/v1/web-search',
    async search(query, count, apiKey, timeout) {
      const res = await axios.post(
        this.url,
        { query, freshness: 'noLimit', summary: true, count },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout
        }
      )
      const items = res.data?.data?.webPages?.value || []
      return items.map(r => ({
        title: r.name || '',
        url: r.url || '',
        snippet: r.summary || r.snippet || '',
        source: 'bocha'
      }))
    }
  },
  // Tavily：海外备用源，也有免费额度
  tavily: {
    url: 'https://api.tavily.com/search',
    async search(query, count, apiKey, timeout) {
      const res = await axios.post(
        this.url,
        { query, max_results: count, search_depth: 'basic' },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout
        }
      )
      return (res.data?.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || '',
        source: 'tavily'
      }))
    }
  }
}

class WebSearchService {
  /**
   * @param {object} cfg - {provider, apiKey, timeout?}
   */
  constructor(cfg = {}) {
    this.provider = cfg.provider
    this.apiKey = cfg.apiKey
    this.timeout = cfg.timeout || 30000
  }

  /**
   * 执行搜索
   * @param {string} query - 搜索关键词
   * @param {number} count - 返回条数（1-10）
   * @returns {Promise<Array<{title, url, snippet, source}>>}
   */
  async search(query, count = 5) {
    const impl = PROVIDERS[this.provider]
    if (!impl) {
      throw createError('E-SEARCH-INVALID-PROVIDER', `不支持的搜索服务商: ${this.provider}`, null, {
        provider: this.provider,
        supported: Object.keys(PROVIDERS)
      })
    }
    const n = parseInt(count, 10)
    const finalCount = Math.min(Math.max(Number.isNaN(n) ? 5 : n, 1), 10)
    try {
      return await impl.search(query, finalCount, this.apiKey, this.timeout)
    } catch (error) {
      // createError 抛出的对象（如 INVALID-PROVIDER）直接透传
      if (error && error.success === false && error.code) throw error
      throw this._classifyError(error)
    }
  }

  _classifyError(error) {
    const status = error?.response?.status
    const code = (() => {
      const httpToCode = { 400: 'E-LLM-400', 401: 'E-LLM-401', 402: 'E-LLM-402', 403: 'E-LLM-403', 413: 'E-LLM-413', 429: 'E-LLM-429', 503: 'E-LLM-503' }
      if (status && httpToCode[status]) return httpToCode[status]
      if (status && status >= 500) return 'E-LLM-500'
      if (error?.code === 'ECONNABORTED') return 'E-NET-408'
      if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET'].includes(error?.code)) return 'E-NET-500'
      return 'E-SYS-999'
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
    return createError(code, null, null, {
      httpStatus: status,
      provider: this.provider,
      rawMessage,
      callSite: 'WebSearchService.search',
      occurredAt: new Date().toISOString()
    })
  }
}

module.exports = WebSearchService
module.exports.PROVIDERS = PROVIDERS
