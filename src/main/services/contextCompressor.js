// 上下文压缩方法集（从 DeepSeekService.js 拆分，优化项 2，行为不变）
// 这些函数作为原型方法挂回 DeepSeekService 类（主文件 Object.assign），
// 通过 this._getConfig 读取配置、this.conversationHistory 维护对话历史。
// 纯函数辅助（messagesToText/selectTail 等）来自既有 contextCompression.js。
const {
  messagesToText,
  DEFAULT_CONTEXT_LIMIT,
  MIN_PRESERVE_RECENT_TOKENS,
  MAX_PRESERVE_RECENT_TOKENS,
  COMPRESS_SYSTEM_PROMPT,
  buildCompressUserPrompt,
  selectTail
} = require('./contextCompression')

  /**
   * 清空对话历史
   */
  function clearHistory() {
    this.conversationHistory = []
  }

  // ========== Task 4: 上下文压缩（context monitor ring button）==========

  /**
   * 调用 DeepSeek API 生成对话摘要（单次非流式）。
   * 不走工具、不走对话历史，temperature 调低（0.3）保证摘要稳定性。
   * @param {object} cfg - _getConfig() 返回的配置
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户提示词（含 5 段模板 + 历史文本）
   * @returns {Promise<{summary: string, realTokens: number}>} 摘要文本 + 真实 token
   */
  async function _callSummaryAPI(cfg, systemPrompt, userPrompt) {
    const baseUrl = cfg.baseUrl || 'https://api.deepseek.com/v1'
    // v8.4.2：添加 30s 超时，避免压缩时 API 卡住导致按钮无限转圈
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 2000
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`LLM API 错误：${response.status} ${errText}`)
      }

      const data = await response.json()
      const summary = data.choices?.[0]?.message?.content || ''
      const realTokens = data.usage?.total_tokens || 0
      return { summary, realTokens }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 压缩上下文：把长对话历史的"head"部分摘要化，"tail"部分保留原样。
   * 用法：返回的 { summary, recentMessages } 由 IPC 传给渲染层，
   *       渲染层把 summary 注入到 system 提示，recentMessages 作为 messages 数组的后半段。
   * @param {Array} messages - 完整 messages 数组
   * @param {string} [previousSummary=''] - 之前累积的摘要（增量摘要）
   * @returns {Promise<{summary: string, recentMessages: Array, realTokens: number}>}
   */
  async function compressContext(messages, previousSummary = '') {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('对话为空，无法压缩')
    }
    const userCount = messages.filter(m => m && m.role === 'user').length
    if (userCount < 2) {
      throw new Error('对话过短，无需压缩')
    }

    const cfg = await this._getConfig()
    const contextLimit = cfg.contextLimit || DEFAULT_CONTEXT_LIMIT
    // 预算 = contextLimit * 25%，再夹到 [2000, 8000] 区间
    const budget = Math.min(
      MAX_PRESERVE_RECENT_TOKENS,
      Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(contextLimit * 0.25))
    )

    // 1. 按预算把 messages 切成 head（待压缩） + tail（保留原样）
    const { head, tail } = selectTail(messages, budget)

    // 2. head → 文本
    const messagesText = messagesToText(head)
    if (!messagesText) {
      throw new Error('无可压缩的对话内容')
    }

    // 3. 拼 5 段 prompt，调 API
    const userPrompt = buildCompressUserPrompt(messagesText, previousSummary)
    const { summary, realTokens } = await this._callSummaryAPI(cfg, COMPRESS_SYSTEM_PROMPT, userPrompt)

    if (!summary || !summary.trim()) {
      throw new Error('AI 未返回有效摘要，请重试')
    }

    return {
      summary: summary.trim(),
      recentMessages: tail,
      // 取 API 真实 token（API 返回 0 时退化为 0）
      realTokens: realTokens || 0
    }
  }

module.exports = { _callSummaryAPI, compressContext, clearHistory }