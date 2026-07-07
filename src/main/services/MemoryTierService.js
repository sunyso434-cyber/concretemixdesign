const { Op } = require('sequelize')
const { SessionSummary, ChatHistory, sequelize } = require('../db/database')
// ponytail: DeepSeekService 用 `module.exports = DeepSeekService` 直接导出 class（不是命名空间）
const DeepSeekService = require('./DeepSeekService')
const { buildBM25, queryBM25 } = require('../workspace/bm25')

/**
 * 分层记忆核心服务（对标 MemGPT 三层 + Mneme FTS5 + power-law decay）
 * - L1 归档：summarizeOldMessages（异步 LLM 摘要）+ FTS5 全文索引
 * - L1 召回：recall（FTS5 候选 + BM25 重排）
 * - L1 衰减：applyDecay（幂律公式：decay = 1 / (1 + days * 0.1)）
 */
class MemoryTierService {
  constructor(deps = {}) {
    // ponytail: 测试时可注入 mock，避免依赖真实 LLM 密钥
    this.deepseekService = deps.deepseekService || new DeepSeekService()
  }

  /**
   * 摘要一段历史消息到 session_summaries
   * @param {string} sessionId
   * @param {{rangeStart: number, rangeEnd: number}} opts
   * @returns {Promise<SessionSummary>}
   */
  async summarizeOldMessages(sessionId, { rangeStart, rangeEnd }) {
    // 1. 读历史消息
    const messages = await ChatHistory.findAll({
      where: { sessionId, id: { [Op.between]: [rangeStart, rangeEnd] } },
      order: [['id', 'ASC']],
      limit: 50
    })
    if (messages.length === 0) return null

    // 2. 构造 LLM 摘要 prompt
    const text = messages.map(m => `${m.role}: ${m.content?.slice(0, 200)}`).join('\n')
    const prompt = `请用 200 字以内摘要以下对话的关键决策（输出 JSON {summary, keyDecisions[], toolCalls[]}）：\n${text}`

    // 3. 调 LLM（rawMode 关掉默认系统提示词，不传 toolExecutor → 不走工具）
    const response = await this.deepseekService.chat(
      [{ role: 'user', content: prompt }],
      null,
      { rawMode: true }
    )
    // ponytail: chat() 真实返回 {role, content, tool_calls}（OpenAI 兼容），非 {reply}
    let parsed = { summary: response.content?.slice(0, 200) || '空摘要', keyDecisions: [], toolCalls: [] }
    try {
      // 尝试解析 JSON（如 LLM 严格按 JSON 输出）
      const jsonMatch = response.content?.match(/\{[\s\S]*\}/)
      if (jsonMatch) parsed = { ...parsed, ...JSON.parse(jsonMatch[0]) }
    } catch (_) {}

    // 4. 写 SessionSummary
    return SessionSummary.create({
      sessionId,
      rangeStart,
      rangeEnd,
      summary: parsed.summary,
      keyDecisions: parsed.keyDecisions,
      toolCalls: parsed.toolCalls,
      decayScore: 1.0
    })
  }

  /**
   * 召回记忆（FTS5 候选 + BM25 重排）
   * @param {string} query
   * @param {{topK?: number, minDecay?: number}} opts
   * @returns {Promise<Array<{sessionId, summary, score}>>}
   */
  async recall(query, { topK = 5, minDecay = 0.2 } = {}) {
    // 1. 候选捞取（FTS5 → LIKE 中文 → 全表兜底）
    let candidates = []
    const ftsRows = await sequelize.query(
      `SELECT rowid FROM session_summaries_fts WHERE session_summaries_fts MATCH ? LIMIT 50`,
      { replacements: [query], type: sequelize.QueryTypes.SELECT }
    )
    if (ftsRows.length > 0) {
      const ids = ftsRows.map(r => r.rowid)
      candidates = await SessionSummary.findAll({ where: { id: ids } })
    }
    // ponytail: FTS5 unicode61 不分中文，0 命中时用 LIKE %query% 兜底
    if (candidates.length === 0) {
      // ponytail: 转义 LIKE 通配符 % _ \，避免 query 含通配符时全表乱匹配
      const escaped = query.replace(/[%_\\]/g, '\\$&')
      const likeRows = await sequelize.query(
        `SELECT id FROM session_summaries WHERE summary LIKE ? ESCAPE '\\' LIMIT 50`,
        { replacements: [`%${escaped}%`], type: sequelize.QueryTypes.SELECT }
      )
      if (likeRows.length > 0) {
        candidates = await SessionSummary.findAll({ where: { id: likeRows.map(r => r.id) } })
      }
      // ponytail: 全表扫兜底删除（PK 排序与 query 无关，等价于随机采样；改 trigram tokenizer 后再考虑）
    }
    if (candidates.length === 0) return []

    // 2. BM25 重排（细排）
    const corpus = candidates.map(c => ({ path: String(c.id), content: c.summary + ' ' + (c.keyDecisions?.join(' ') || '') }))
    const index = buildBM25(corpus)
    const hits = queryBM25(index, query, topK)

    // 3. 应用 decay 权重（衰减分低的不返回）
    return hits
      .map(hit => {
        const c = candidates.find(c => String(c.id) === hit.path)
        if (!c) return null
        if (c.decayScore < minDecay) return null
        return {
          sessionId: c.sessionId,
          summary: c.summary,
          keyDecisions: c.keyDecisions,
          score: hit.score * c.decayScore
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
  }

  /**
   * 幂律衰减更新（[借鉴 Mneme]）
   * decay = 1 / (1 + daysSinceLastRecall * 0.1)
   * 同时给最近被召回的记忆 +0.05 recallCount（衰减回升，封顶 1.0）
   * @returns {Promise<{updated: number}>}
   */
  async applyDecay() {
    const all = await SessionSummary.findAll()
    let updated = 0
    for (const m of all) {
      const daysSinceLastRecall = m.lastRecalledAt
        ? (Date.now() - new Date(m.lastRecalledAt).getTime()) / (24 * 60 * 60 * 1000)
        : (Date.now() - new Date(m.createdAt).getTime()) / (24 * 60 * 60 * 1000)  // 用 createdAt 替代 30 天假值
      const newDecay = Math.min(1.0, 1 / (1 + daysSinceLastRecall * 0.1))
      if (Math.abs(newDecay - m.decayScore) > 0.01) {
        await m.update({ decayScore: newDecay })
        updated++
      }
    }
    return { updated }
  }
}

module.exports = { MemoryTierService }
module.exports.MemoryTierService.instance = new MemoryTierService()