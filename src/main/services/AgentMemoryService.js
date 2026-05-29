const { ChatHistory, UserPreference, CorrectionRule } = require('../db/database')
const Sequelize = require('sequelize')
const { Op } = Sequelize

const DEFAULT_WINDOW_SIZE = 20

class AgentMemoryService {
  // ===== 对话历史 =====

  async saveMessage({ sessionId, role, content, toolCalls, metadata }) {
    return ChatHistory.create({
      sessionId,
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      toolCalls: toolCalls || null,
      metadata: metadata || null
    })
  }

  async getHistory(sessionId, { limit = DEFAULT_WINDOW_SIZE, before } = {}) {
    const where = { sessionId }
    if (before) {
      where.createdAt = { [Op.lt]: new Date(before) }
    }
    const messages = await ChatHistory.findAll({
      where,
      order: [['createdAt', 'ASC']],
      limit
    })
    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      metadata: m.metadata,
      createdAt: m.createdAt
    }))
  }

  getRecentHistory(sessionId, windowSize = DEFAULT_WINDOW_SIZE) {
    return this.getHistory(sessionId, { limit: windowSize })
  }

  async getSessionIds(limit = 50) {
    const rows = await ChatHistory.findAll({
      attributes: ['sessionId', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: limit * 2
    })
    const seen = new Set()
    const sessions = []
    for (const row of rows) {
      if (!seen.has(row.sessionId)) {
        seen.add(row.sessionId)
        sessions.push({ sessionId: row.sessionId, lastActivity: row.createdAt })
        if (sessions.length >= limit) break
      }
    }
    return sessions
  }

  async deleteSession(sessionId) {
    return ChatHistory.destroy({ where: { sessionId } })
  }

  // ===== 用户偏好 =====

  async savePreference(key, value, category = 'general') {
    return UserPreference.upsert({ key, value, category })
  }

  async getPreference(key) {
    const pref = await UserPreference.findOne({ where: { key } })
    return pref ? pref.value : null
  }

  async getAllPreferences() {
    const prefs = await UserPreference.findAll()
    const result = {}
    for (const p of prefs) {
      result[p.key] = p.value
    }
    return result
  }

  // ===== 修正规则 =====

  async saveCorrection({ context, originalSuggestion, userCorrection, toolName }) {
    return CorrectionRule.create({
      context,
      originalSuggestion,
      userCorrection,
      toolName: toolName || null,
      usageCount: 0
    })
  }

  async findSimilarCorrections(queryContext, toolName, limit = 3) {
    const where = {}
    if (toolName) where.toolName = toolName

    const rules = await CorrectionRule.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: 50
    })

    if (rules.length === 0) return []

    const scored = rules.map(r => ({
      rule: r,
      score: this._tfidfSimilarity(queryContext, r.context)
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(s => ({
      context: s.rule.context,
      originalSuggestion: s.rule.originalSuggestion,
      userCorrection: s.rule.userCorrection,
      score: s.score
    }))
  }

  async deleteCorrection(id) {
    return CorrectionRule.destroy({ where: { id } })
  }

  async getAllCorrections() {
    return CorrectionRule.findAll({ order: [['updatedAt', 'DESC']] })
  }

  // ===== 窗口截断提示词构建 =====

  async buildMemoryContext(sessionId, { windowSize = DEFAULT_WINDOW_SIZE } = {}) {
    const [preferences, corrections] = await Promise.all([
      this.getAllPreferences(),
      this.findSimilarCorrections({}, null, 5)
    ])

    const parts = []

    if (Object.keys(preferences).length > 0) {
      parts.push('用户偏好:')
      for (const [key, value] of Object.entries(preferences)) {
        parts.push(`- ${key}: ${JSON.stringify(value)}`)
      }
    }

    if (corrections.length > 0) {
      parts.push('\n用户最近的修正记录（请在生成建议时参考，避免重复过去的错误）:')
      for (const c of corrections) {
        parts.push(`- 原建议: ${JSON.stringify(c.originalSuggestion)} → 用户修正为: ${JSON.stringify(c.userCorrection)}`)
      }
    }

    return parts.join('\n')
  }

  async buildHistoryMessages(sessionId, { limit = DEFAULT_WINDOW_SIZE } = {}) {
    const history = await this.getRecentHistory(sessionId, limit)
    if (history.length === 0) return []

    const messages = []
    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        // 只保留纯文本回复，跳过带 tool_calls 的消息
        // 原因：tool_calls 后面必须跟 tool 响应，但 DB 中没有保存 tool 响应
        //       传不完整的 tool_calls 会导致 API 报格式错误
        if (msg.content && !msg.toolCalls) {
          messages.push({ role: 'assistant', content: msg.content })
        }
      }
      // 跳过 role='tool' 和带 toolCalls 的 assistant 消息
    }

    // 确保最后一条是 assistant 消息（如果最后一条是 user，说明上次 run 中断了，移除它避免 LLM 回答过时问题）
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      messages.pop()
    }

    return messages
  }

  /**
   * 获取资源摘要，用于增强 System Prompt
   * @returns {Promise<Object>} 资源统计信息
   */
  async getResourceSummary() {
    const { MixDesign, BasicMixDesign, OptimizationHistory } = require('../db/database')
    const knowledgeService = require('./StandardKnowledgeService')
    const { fn, col } = require('sequelize')

    const [
      designHistoryResult,
      optimizationResult,
      standardsResult,
      strengthResult,
      preferencesResult
    ] = await Promise.allSettled([
      // 统计历史设计记录数（方案库 + 基准配合比库）
      Promise.all([MixDesign.count(), BasicMixDesign.count()]).then(([a, b]) => a + b),
      // 统计优化历史记录数
      OptimizationHistory.count(),
      // 获取规范知识包数量
      knowledgeService.listStandards(),
      // 统计用户常用强度等级（从历史记录取 top 3）
      MixDesign.findAll({
        attributes: ['strength', [fn('COUNT', col('strength')), 'cnt']],
        group: ['strength'],
        order: [[fn('COUNT', col('strength')), 'DESC']],
        limit: 3,
        raw: true
      }),
      // 从 UserPreference 表读取用户偏好
      this.getAllPreferences()
    ])

    let designHistoryCount = 0
    if (designHistoryResult.status === 'fulfilled') {
      designHistoryCount = designHistoryResult.value
    } else {
      console.warn('[AgentMemoryService] getResourceSummary: failed to count MixDesign:', designHistoryResult.reason?.message)
    }

    let optimizationCount = 0
    if (optimizationResult.status === 'fulfilled') {
      optimizationCount = optimizationResult.value
    } else {
      console.warn('[AgentMemoryService] getResourceSummary: failed to count OptimizationHistory:', optimizationResult.reason?.message)
    }

    let standardsCount = 0
    if (standardsResult.status === 'fulfilled') {
      standardsCount = standardsResult.value.length
    } else {
      console.warn('[AgentMemoryService] getResourceSummary: failed to listStandards:', standardsResult.reason?.message)
    }

    let commonStrengthGrades = []
    if (strengthResult.status === 'fulfilled') {
      commonStrengthGrades = strengthResult.value.map(r => r.strength).filter(Boolean)
    } else {
      console.warn('[AgentMemoryService] getResourceSummary: failed to query commonStrengthGrades:', strengthResult.reason?.message)
    }

    let userPreferences = {}
    if (preferencesResult.status === 'fulfilled') {
      const prefs = preferencesResult.value
      for (const [key, value] of Object.entries(prefs)) {
        if (key.toLowerCase().includes('cement') || key.toLowerCase().includes('flyash') ||
            key.toLowerCase().includes('slag') || key.toLowerCase().includes('strength')) {
          userPreferences[key] = value
        }
      }
    } else {
      console.warn('[AgentMemoryService] getResourceSummary: failed to getAllPreferences:', preferencesResult.reason?.message)
    }

    return {
      standardsCount,
      designHistoryCount,
      optimizationCount,
      userPreferences: {
        commonStrengthGrades,
        ...userPreferences
      }
    }
  }

  // ===== TF-IDF 相似度 =====

  _tfidfSimilarity(ctx1, ctx2) {
    const a = JSON.stringify(ctx1).toLowerCase()
    const b = JSON.stringify(ctx2).toLowerCase()
    if (!a || !b) return 0

    const wordsA = new Set(this._tokenize(a))
    const wordsB = new Set(this._tokenize(b))
    if (wordsA.size === 0 || wordsB.size === 0) return 0

    let intersection = 0
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++
    }
    const union = wordsA.size + wordsB.size - intersection
    return union > 0 ? intersection / union : 0
  }

  _tokenize(text) {
    return text
      .split(/[\s,，。！？、{}[\]":]+/)
      .filter(w => w.length >= 2)
  }
}

module.exports = new AgentMemoryService()
