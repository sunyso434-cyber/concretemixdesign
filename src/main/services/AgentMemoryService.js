const { ChatHistory, UserPreference, CorrectionRule } = require('../db/database')
const Sequelize = require('sequelize')
const { Op } = Sequelize

const DEFAULT_WINDOW_SIZE = 20

class AgentMemoryService {
  // ===== 对话历史 =====

  async saveMessage({ sessionId, role, content, toolCallId, toolCalls, metadata }) {
    return ChatHistory.create({
      sessionId,
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      toolCallId: toolCallId || null,
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
      order: [['createdAt', 'DESC']],
      limit
    })
    messages.reverse() // DESC 取最新 N 条后反转回时间正序
    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCallId: m.toolCallId,
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

  async buildMemoryContext(sessionId, { windowSize = DEFAULT_WINDOW_SIZE, queryContext = {} } = {}) {
    const [preferences, corrections] = await Promise.all([
      this.getAllPreferences(),
      this.findSimilarCorrections(queryContext, null, 5)
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
    const rows = await this.getRecentHistory(sessionId, limit)
    if (rows.length === 0) return []

    const messages = []
    for (const row of rows) {
      // SQLite JSON 字段可能是字符串，需要安全解析
      let toolCalls = null
      if (row.toolCalls) {
        toolCalls = typeof row.toolCalls === 'string' ? JSON.parse(row.toolCalls) : row.toolCalls
      }

      const msg = {
        role: row.role,
        content: (row.content == null && toolCalls) ? null : (row.content || '')
      }
      if (row.toolCallId) msg.tool_call_id = row.toolCallId
      if (toolCalls) msg.tool_calls = toolCalls

      // metadata 可能也是字符串
      let meta = row.metadata
      if (typeof meta === 'string') {
        try { meta = JSON.parse(meta) } catch (_) { meta = null }
      }
      if (meta && meta.reasoning_content) {
        msg.reasoning_content = meta.reasoning_content
      }
      if (meta && meta.name) {
        msg.name = meta.name
      }
      messages.push(msg)
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
    if (!ctx1 || !ctx2) return 0
    // 将输入统一转为对象
    const obj1 = typeof ctx1 === 'string' ? (() => { try { return JSON.parse(ctx1) } catch { return {} } })() : ctx1
    const obj2 = typeof ctx2 === 'string' ? (() => { try { return JSON.parse(ctx2) } catch { return {} } })() : ctx2
    // 逐字段精确匹配，避免整体分词导致 "C30" 和 "C50" 虚高
    const keys = new Set([...Object.keys(obj1), ...Object.keys(obj2)])
    if (keys.size === 0) return 0
    let matchScore = 0
    for (const key of keys) {
      const v1 = obj1[key]
      const v2 = obj2[key]
      if (v1 !== undefined && v2 !== undefined) {
        if (String(v1) === String(v2)) {
          matchScore += 1 // 精确匹配
        } else if (String(v1).includes(String(v2)) || String(v2).includes(String(v1))) {
          matchScore += 0.5 // 包含关系
        }
      }
    }
    return matchScore / keys.size
  }
}

module.exports = new AgentMemoryService()
