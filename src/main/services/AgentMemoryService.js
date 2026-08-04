const { ChatHistory, CorrectionRule, ChatSession, SessionSummary } = require('../db/database')
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
    // Schema 校验（v2 新增）
    if (!sessionId || !role) {
      throw new Error('saveMessage: sessionId 和 role 必填')
    }
    if (role === 'tool' && !toolCallId) {
      throw new Error('saveMessage: tool 消息必须有 toolCallId')
    }
    if (role === 'assistant' && !content && (!toolCalls || toolCalls.length === 0)) {
      throw new Error('saveMessage: assistant 消息必须至少有 content 或 toolCalls')
    }

    // P1-3：toolCalls 非 null 时必须是数组
    if (toolCalls !== null && toolCalls !== undefined) {
      if (!Array.isArray(toolCalls)) {
        throw new Error('saveMessage: toolCalls 必须是数组或 null')
      }
    }

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
    // P1：先记录 session 关联的工作区，删除归档目录后再清数据库
    let workspacePath = null
    try {
      const session = await ChatSession.findOne({ where: { sessionId } })
      workspacePath = session?.workspacePath || null
    } catch (_) {}

    await ChatSession.destroy({ where: { sessionId } })
    await ChatHistory.destroy({ where: { sessionId } })
    // L1 归档记忆按 session 隔离，必须同步删
    try {
      const removed = await SessionSummary.destroy({ where: { sessionId } })
      if (removed > 0) console.log(`[AgentMemoryService] 删除 ${removed} 条 SessionSummary for ${sessionId}`)
    } catch (err) {
      console.warn('[AgentMemoryService] 清 SessionSummary 失败:', err.message)
    }

    // 删除工作区里的 chat-history 归档目录 + 重建 BM25
    if (global.chatHistorySync?.removeSessionArchive) {
      try {
        await global.chatHistorySync.removeSessionArchive(sessionId, workspacePath)
      } catch (err) {
        console.warn('[AgentMemoryService] 清工作区归档失败:', err.message)
      }
    }

    return { deleted: true }
  }

  async duplicateSession(sessionId) {
    const session = await ChatSession.findOne({ where: { sessionId } })
    if (!session) throw new Error('会话不存在')
    const messages = await ChatHistory.findAll({
      where: { sessionId },
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    })
    const newSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newName = `${session.sessionName || '未命名对话'} (副本)`
    await ChatSession.create({
      sessionId: newSessionId,
      workspacePath: session.workspacePath,
      sessionName: newName,
      lastActivity: new Date()
    })
    for (const msg of messages) {
      await ChatHistory.create({
        sessionId: newSessionId,
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls,
        toolCallId: msg.toolCallId,
        attachments: msg.attachments,
        metadata: msg.metadata
      })
    }
    return { sessionId: newSessionId, sessionName: newName }
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
    const { buildBM25, queryBM25 } = require('../workspace/bm25')

    const where = {}
    if (toolName) where.toolName = toolName

    const rules = await CorrectionRule.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: 50
    })

    if (rules.length === 0) return []

    const queryText = typeof queryContext === 'string'
      ? queryContext
      : JSON.stringify(queryContext)

    const corpus = rules.map(r => ({ path: String(r.id), content: r.context || '' }))
    const bm25Index = buildBM25(corpus)
    const hits = queryBM25(bm25Index, queryText, limit)

    return hits.map(hit => {
      const rule = rules.find(r => String(r.id) === hit.path)
      if (!rule) return null
      return {
        context: rule.context,
        originalSuggestion: rule.originalSuggestion,
        userCorrection: rule.userCorrection,
        score: hit.score
      }
    }).filter(Boolean)
  }

  async deleteCorrection(id) {
    return CorrectionRule.destroy({ where: { id } })
  }

  async getAllCorrections() {
    return CorrectionRule.findAll({ order: [['updatedAt', 'DESC']] })
  }

  // ===== 窗口截断提示词构建 =====

  // v2（Task 8）：buildMemoryContext 改名 buildAgentMdBlock，只返回 agent.md 规则整段
  // - 不再拼接 history（历史走 buildHistoryMessages 单独走 messages 流）
  // - 参数 _sessionId 标记 unused（保留签名避免破坏其它调用点；下个 step 改调用方）
  async buildAgentMdBlock(_sessionId) {
    const agentMdService = this.agentMdService || require('../agent/agentMd').getInstance()
    return agentMdService.getFormattedRules() || '（未配置）'
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

    // v8.4.x：tool 消息孤儿救援（DeepSeek API 硬性要求 tool 消息必须紧跟带 tool_calls 的 assistant）
    // 根因：数据库 ChatHistory.toolCalls 字段可能为 null（老数据无字段、空数组被存为 null、
    //      Sequelize JSON 字段序列化丢失等），buildHistoryMessages 输出"孤儿"tool 消息
    //      → DeepSeek API 返回 E-LLM-400 "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
    // 修复：对每条 tool 消息向前找最近 assistant（不跨过 user），按需补占位或标记丢弃
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.role !== 'tool' || !m.tool_call_id) continue

      // 向前找最近的 assistant（遇到 user 就停 — 中间隔 user 说明这条 tool 已是孤儿）
      let parentIdx = -1
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') break
        if (messages[j].role === 'assistant') {
          parentIdx = j
          break
        }
      }

      if (parentIdx < 0) {
        // 找不到父 assistant（session 第一条就是 tool）→ 标记丢弃
        m._drop = true
        continue
      }

      const parent = messages[parentIdx]
      if (!Array.isArray(parent.tool_calls)) parent.tool_calls = []
      const hasMatch = parent.tool_calls.some(tc => tc && tc.id === m.tool_call_id)
      if (!hasMatch) {
        // 父 assistant 缺对应 tool_calls → 补占位让 API 接受
        // name='unknown_recovered' + arguments='{}' 让 LLM 知道这是历史数据补全的占位
        parent.tool_calls.push({
          id: m.tool_call_id,
          type: 'function',
          function: { name: 'unknown_recovered', arguments: '{}' }
        })
      }
    }

    // 过滤掉孤儿 tool 消息
    const filtered = messages.filter(m => !m._drop)

    // v9.1.0 修复：不再移除最后一条 user 消息
    // - 旧逻辑：如果最后一条是 user（AI 回复未保存成功），直接 pop 掉
    // - 问题：会导致"刚发的用户消息切换会话后丢失"，体验很差
    // - 现在：保留用户消息，LLM 看到未答复的问题可以继续回答，不会丢失上下文

    return filtered
  }

  /**
   * P0 断点续跑：检测崩溃窗口（v5 方案 B）
   *
   * 查原始 DB 行（不经 buildHistoryMessages，避免孤儿救援污染判断），取最后一条 assistant，
   * 检查其 tool_calls 是否有 id 不在所有 tool 消息里（未配对 = 工具执行到一半崩了）。
   *
   * 5 种形态（spec 7.1）：
   * - 最后一条 assistant 无 tool_calls → needAsk=false
   * - 最后一条 assistant tool_calls 全配对 → needAsk=false
   * - 最后一条 assistant 有未配对 tool_calls → needAsk=true，返回所有未配对
   * - 最后一条是 tool → needAsk=false（孤儿救援已处理）
   * - 最后一条是 user → needAsk=false
   *
   * @returns {Promise<{needAsk:boolean, unpairedToolCalls:Array}>}
   */
  async detectCrashWindow(sessionId) {
    const rows = await this.getRecentHistory(sessionId, 20)
    if (rows.length === 0) return { needAsk: false, unpairedToolCalls: [] }

    const last = rows[rows.length - 1]
    // 最后一条不是 assistant，或无 tool_calls → 不需问
    if (last.role !== 'assistant' || !last.toolCalls) {
      return { needAsk: false, unpairedToolCalls: [] }
    }

    // 解析 toolCalls（DB 里可能是字符串）
    let toolCalls = last.toolCalls
    if (typeof toolCalls === 'string') {
      try { toolCalls = JSON.parse(toolCalls) } catch (_) { return { needAsk: false, unpairedToolCalls: [] } }
    }
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return { needAsk: false, unpairedToolCalls: [] }
    }

    // 收集所有 tool 消息的 toolCallId（已执行的）
    const executedIds = new Set()
    for (const r of rows) {
      if (r.role === 'tool' && r.toolCallId) executedIds.add(r.toolCallId)
    }

    // 找未配对的 tool_calls
    const unpaired = toolCalls.filter(tc => tc && tc.id && !executedIds.has(tc.id))
    return { needAsk: unpaired.length > 0, unpairedToolCalls: unpaired }
  }

  /**
   * P0 断点续跑：串行重跑未配对的 tool_calls（v5 新增）
   *
   * - 串行调 skillExecutor.execute（避免并发引入复杂性）
   * - 结果作为 tool 消息落库，配对原 tool_call_id
   * - metadata 标记 rerun:true，便于追溯
   *
   * @param {string} sessionId
   * @param {Array} unpairedToolCalls - detectCrashWindow 返回的未配对 tool_calls
   * @param {object} context - { skillExecutor, sessionId }
   * @returns {Promise<Array>} 每个工具的执行结果 { toolCallId, success, result }
   */
  async rerunUnpairedToolCalls(sessionId, unpairedToolCalls, context) {
    const { skillExecutor } = context
    const results = []
    for (const tc of unpairedToolCalls) {
      const name = tc.function?.name
      let args = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch (_) {}
      let execResult
      try {
        // v0.6.0 Task 1.12：传 toolCallId（tc.id）给写操作 skill 作幂等键
        // 重跑时复用原 tool_call_id → save_mix_design/save_sales_quote 查重命中 → 不重复写
        execResult = await skillExecutor.execute(name, args, { sessionId, toolCallId: tc.id })
      } catch (e) {
        execResult = { success: false, error: e.message }
      }
      // 落库：配对原 tool_call_id，metadata 标记 rerun
      try {
        await this.saveMessage({
          sessionId,
          role: 'tool',
          content: JSON.stringify(execResult),
          toolCallId: tc.id,
          metadata: { rerun: true, originalToolName: name }
        })
      } catch (_) {}
      results.push({ toolCallId: tc.id, toolName: name, success: !!execResult?.success, result: execResult })
    }
    return results
  }

  /**
   * P0 断点续跑：从 checkpoint 恢复 todo 快照到内存（v5 新增）
   *
   * - 读 agent_checkpoint.todo_snapshot
   * - 调 todoManage.restoreFromSnapshot 还原进内存 Map
   * - 返回 last_step（供主循环恢复 step 计数器，允许滞后 1 步）
   *
   * @returns {Promise<{lastStep:number, todoSnapshot:Array}>}
   */
  async restoreCheckpoint(sessionId) {
    let lastStep = 0
    let todoSnapshot = []
    try {
      const { AgentCheckpoint } = require('../db/database')
      if (AgentCheckpoint) {
        const cp = await AgentCheckpoint.findOne({ where: { sessionId } })
        if (cp) {
          lastStep = cp.lastStep || 0
          if (cp.todoSnapshot) {
            try { todoSnapshot = JSON.parse(cp.todoSnapshot) } catch (_) { todoSnapshot = [] }
          }
        }
      }
    } catch (_) { /* DB 未就绪 */ }

    // 还原 todo 到内存
    if (todoSnapshot.length > 0) {
      try {
        const todoManage = require('../skills/todo-manage')
        if (typeof todoManage.restoreFromSnapshot === 'function') {
          todoManage.restoreFromSnapshot(sessionId, todoSnapshot)
        }
      } catch (_) {}
    }
    return { lastStep, todoSnapshot }
  }

  /**
   * 获取资源摘要，用于增强 System Prompt
   * @returns {Promise<Object>} 资源统计信息
   */
  async getResourceSummary() {
    const { MixDesign, OptimizationHistory } = require('../db/database')
    const { fn, col } = require('sequelize')

    const [
      designHistoryResult,
      optimizationResult,
      strengthResult
    ] = await Promise.allSettled([
      // 统计历史设计记录数（v10.10.2 起 BasicMixDesign 库下线，只剩方案库）
      MixDesign.count(),
      // 统计优化历史记录数
      OptimizationHistory.count(),
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

    let commonStrengthGrades = []
    if (strengthResult.status === 'fulfilled') {
      commonStrengthGrades = strengthResult.value.map(r => r.strength).filter(Boolean)
    } else {
      console.warn('[AgentMemoryService] getResourceSummary: failed to query commonStrengthGrades:', strengthResult.reason?.message)
    }

    // v2: userRulesSummary 简化为"常用强度 + 备注"（不再读取 agent.md professionalPrefs）
    const userRulesSummary = commonStrengthGrades.length > 0
      ? `常用强度：${commonStrengthGrades.slice(0, 3).join('、')}`
      : ''

    return {
      designHistoryCount,
      optimizationCount,
      userRulesSummary
    }
  }

}

module.exports = new AgentMemoryService()
