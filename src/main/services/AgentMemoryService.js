const { ChatHistory, CorrectionRule } = require('../db/database')
const Sequelize = require('sequelize')
const { Op } = Sequelize

const DEFAULT_WINDOW_SIZE = 20

class AgentMemoryService {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.agentMdService] - 可选注入 agentMdService,便于测试和解耦
   */
  constructor({ agentMdService } = {}) {
    this.agentMdService = agentMdService || null
  }

  // ===== 对话历史 =====

  /**
   * 持久化单条消息到 ChatHistory。
   *
   * @param {Object} params
   * @param {string} params.sessionId  会话 ID
   * @param {string} params.role       消息角色 (user / assistant / system / tool)
   * @param {string|Object} params.content  消息内容
   * @param {string} [params.toolCallId]  工具消息对应的 tool_call ID
   * @param {Array}  [params.toolCalls]   assistant 消息的工具调用列表
   * @param {Object} [params.metadata]    附加元数据
   * @param {string|null} [params.stopReason]  停止原因
   *
   * 说明:
   * - `toolCallId` 和 `toolCalls` 保留在 `saveMessage` 签名里以便后续扩展
   *   (例如持久化含 tool_calls 的 assistant 消息)。
   * - `stopReason` 当前仅支持 `'aborted'`，其他取值会被当作 null（视为无停止原因）。
   */
  async saveMessage({ sessionId, role, content, toolCallId, toolCalls, metadata, stopReason }) {
    // v1.5.3 关键：自动绑当前工作区
    const workspacePath = global.workspaceManager?.current()?.path?.replace(/\\/g, '/') || null

    const msg = await ChatHistory.create({
      sessionId,
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      toolCallId: toolCallId || null,
      toolCalls: toolCalls || null,
      metadata: metadata || null,
      stopReason: stopReason || null,
      workspacePath  // v1.5.3 新增
    })

    // v1.5.3 新增：通知 ChatHistorySync 加入 pending 队列（5 秒 debounce 后批量导出）
    // ChatHistorySync 实例在 main.js 启动时挂 global
    // TODO: Task 2.12 创建 ChatHistorySync 后自动生效
    const exporter = global.chatHistorySync
    if (exporter && workspacePath) {
      try {
        exporter.markPending(sessionId)
      } catch (err) {
        console.warn('[AgentMemoryService] markPending failed:', err.message)
      }
    }

    return msg
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
    // 1. 读取 agent.md(全局,不依赖 sessionId)
    const agentMdService = this.agentMdService || require('../agent/agentMd').getInstance()
    const agentMdRules = agentMdService.getFormattedRules() || '（未配置）'

    // 2. 保留 sessionId 用于其他用途(如历史摘要)
    const history = await this.getHistory(sessionId)

    // 3. 组装
    return `# 用户自定义规则
${agentMdRules}

# 历史摘要
${history}
`
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
      // ⚠️ DeepSeek thinking 模式要求：reasoning_content 只能出现在最新的 assistant 消息中
      // 历史消息中不能携带 reasoning_content，否则 API 返回 400
      // 因此只保留 name，不保留 reasoning_content

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
      strengthResult
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
      })
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

    // 从 agent.md 读取偏好（v2 改造：不再走 UserPreference 表）
    const { getInstance: getAgentMdService } = require('../agent/agentMd')
    let agentMdPrefs = { materials: [], method: null }
    try {
      const agentMd = getAgentMdService().getCached()
      agentMdPrefs = agentMd.parsed.professionalPrefs || { materials: [], method: null }
    } catch (err) {
      console.warn('[AgentMemoryService] 读取 agent.md 偏好失败:', err.message)
    }

    return {
      standardsCount,
      designHistoryCount,
      optimizationCount,
      userPreferences: {
        commonStrengthGrades,
        materials: agentMdPrefs.materials,
        method: agentMdPrefs.method
      },
      // 新增字段：注入到 prompt 的中文摘要（spec §7.2）
      preferenceSummary: this._formatPreferenceSummary(agentMdPrefs)
    }
  }

  /**
   * 把 agent.md 偏好格式化为中文摘要（用于 prompt 注入）
   * @param {{materials: Array, method: string|null}} prefs
   * @returns {string}
   */
  _formatPreferenceSummary(prefs) {
    const lines = []
    const mats = (prefs && prefs.materials) || []
    if (mats.length > 0) {
      const parts = mats.map(m => {
        const v = m.values ? m.values.join('、') : m.value
        const metric = m.metric ? `${m.metric} ` : ''
        return `${m.category}${m.dimension}偏好${metric}${v}`
      })
      lines.push(`- 选材：${parts.join('；')}`)
    }
    if (prefs && prefs.method) {
      lines.push(`- 计算方法：${prefs.method}`)
    }
    return lines.join('\n')
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
