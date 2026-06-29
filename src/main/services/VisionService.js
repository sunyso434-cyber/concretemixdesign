const axios = require('axios')
const { createError } = require('../agent/ErrorCodes')

class VisionService {
  /**
   * @param {object} cfg - {apiUrl, apiKey, model, maxDimension?, maxSizeMb?}
   */
  constructor(cfg = {}) {
    this.apiUrl = cfg.apiUrl
    this.apiKey = cfg.apiKey
    this.model = cfg.model
    this.maxDimension = cfg.maxDimension || 1024
    this.maxSizeMb = cfg.maxSizeMb || 10
    this.timeout = cfg.timeout || 120000
  }

  /**
   * 调视觉 API（OpenAI Chat Completions 兼容格式）
   * @param {object} args - {base64: string, systemPrompt?: string, userPrompt?: string, maxTokens?: number}
   * @returns {Promise<{content: string, usage?: object, raw: object}>}
   */
  async analyze({ base64, systemPrompt = '', userPrompt = '请分析这张图片', maxTokens = 4096 } = {}) {
    if (!base64 || typeof base64 !== 'string') {
      throw createError('E-SYS-999', '缺少图片数据', '请传入 base64 编码的图片')
    }

    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: base64 } }
      ]
    })

    try {
      const response = await axios.post(
        `${this.apiUrl.replace(/\/$/, '')}/chat/completions`,
        { model: this.model, messages, max_tokens: maxTokens },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: this.timeout
        }
      )
      const message = response.data?.choices?.[0]?.message
      return {
        content: message?.content || '',
        usage: response.data?.usage,
        raw: response.data
      }
    } catch (error) {
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
      endpoint: this.apiUrl,
      rawMessage,
      callSite: 'VisionService.analyze',
      occurredAt: new Date().toISOString()
    })
  }
}

module.exports = VisionService
