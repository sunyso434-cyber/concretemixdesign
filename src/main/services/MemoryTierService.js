const { Op } = require('sequelize')
const { SessionSummary, ChatHistory, sequelize } = require('../db/database')
const DeepSeekService = require('./DeepSeekService')
const { buildBM25, queryBM25 } = require('../workspace/bm25')

class MemoryTierService {
  constructor(deps = {}) {
    this._hasInjectedDeepseek = Boolean(deps.deepseekService)
    this.deepseekService = deps.deepseekService || new DeepSeekService()
  }

  setDeepSeekService(deepseekService) {
    this._hasInjectedDeepseek = Boolean(deepseekService)
    this.deepseekService = deepseekService
  }

  _getDeepSeekService() {
    if (this._hasInjectedDeepseek && this.deepseekService) return this.deepseekService
    if (typeof global !== 'undefined' && global.deepseekService) return global.deepseekService
    return this.deepseekService
  }

  async summarizeNextBatch(sessionId, { batchSize = 20, minMessages = batchSize } = {}) {
    const lastSummary = await SessionSummary.findOne({
      where: { sessionId },
      order: [['rangeEnd', 'DESC']]
    })

    const where = { sessionId }
    if (lastSummary?.rangeEnd) {
      where.id = { [Op.gt]: lastSummary.rangeEnd }
    }

    const messages = await ChatHistory.findAll({
      where,
      order: [['id', 'ASC']],
      limit: batchSize
    })

    if (messages.length < minMessages) return null

    return this.summarizeOldMessages(sessionId, {
      rangeStart: messages[0].id,
      rangeEnd: messages[messages.length - 1].id
    })
  }

  async summarizeOldMessages(sessionId, { rangeStart, rangeEnd }) {
    const existing = await SessionSummary.findOne({
      where: { sessionId, rangeStart, rangeEnd }
    })
    if (existing) return existing

    const messages = await ChatHistory.findAll({
      where: { sessionId, id: { [Op.between]: [rangeStart, rangeEnd] } },
      order: [['id', 'ASC']],
      limit: 50
    })
    if (messages.length === 0) return null

    const deepseekService = this._getDeepSeekService()
    if (!deepseekService || typeof deepseekService.chat !== 'function') {
      throw new Error('LLM service is not initialized for memory summarization')
    }
    this.deepseekService = deepseekService

    const text = messages.map(m => `${m.role}: ${String(m.content || '').slice(0, 200)}`).join('\n')
    const prompt = `Summarize the key decisions in this conversation within 200 Chinese characters. Return JSON: {"summary":"...","keyDecisions":[],"toolCalls":[]}.\n${text}`

    const response = await deepseekService.chat(
      [{ role: 'user', content: prompt }],
      null,
      { rawMode: true }
    )

    let parsed = {
      summary: response.content?.slice(0, 200) || 'empty summary',
      keyDecisions: [],
      toolCalls: []
    }
    try {
      const jsonMatch = response.content?.match(/\{[\s\S]*\}/)
      if (jsonMatch) parsed = { ...parsed, ...JSON.parse(jsonMatch[0]) }
    } catch (_) {}

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

  async recall(query, { topK = 5, minDecay = 0.2 } = {}) {
    const normalizedQuery = String(query || '').trim()
    if (!normalizedQuery) return []

    let candidates = []
    try {
      const ftsRows = await sequelize.query(
        `SELECT rowid FROM session_summaries_fts WHERE session_summaries_fts MATCH ? LIMIT 50`,
        { replacements: [normalizedQuery], type: sequelize.QueryTypes.SELECT }
      )
      if (ftsRows.length > 0) {
        candidates = await SessionSummary.findAll({ where: { id: ftsRows.map(r => r.rowid) } })
      }
    } catch (err) {
      console.warn('[MemoryTierService.recall] FTS search failed, falling back to LIKE:', err.message)
    }

    if (candidates.length === 0) {
      const escaped = normalizedQuery.replace(/[%_\\]/g, '\\$&')
      const likeRows = await sequelize.query(
        `SELECT id FROM session_summaries WHERE summary LIKE ? ESCAPE '\\' LIMIT 50`,
        { replacements: [`%${escaped}%`], type: sequelize.QueryTypes.SELECT }
      )
      if (likeRows.length > 0) {
        candidates = await SessionSummary.findAll({ where: { id: likeRows.map(r => r.id) } })
      }
    }
    if (candidates.length === 0) return []

    const corpus = candidates.map(c => ({
      path: String(c.id),
      content: `${c.summary || ''} ${(c.keyDecisions || []).join(' ')}`
    }))
    const index = buildBM25(corpus)
    const hits = queryBM25(index, normalizedQuery, topK)
    const now = new Date()

    const results = []
    for (const hit of hits) {
      const candidate = candidates.find(c => String(c.id) === hit.path)
      if (!candidate || candidate.decayScore < minDecay) continue

      const score = hit.score * candidate.decayScore
      results.push({
        sessionId: candidate.sessionId,
        summary: candidate.summary,
        keyDecisions: candidate.keyDecisions,
        score
      })

      const recallCount = (candidate.recallCount || 0) + 1
      const decayScore = Math.min(1.0, Number(candidate.decayScore || 1) + 0.05)
      await candidate.update({ recallCount, lastRecalledAt: now, decayScore })
    }

    return results.sort((a, b) => b.score - a.score)
  }

  async applyDecay() {
    const all = await SessionSummary.findAll()
    let updated = 0
    for (const memory of all) {
      const anchor = memory.lastRecalledAt || memory.createdAt
      const daysSinceLastRecall = (Date.now() - new Date(anchor).getTime()) / (24 * 60 * 60 * 1000)
      const newDecay = Math.min(1.0, 1 / (1 + daysSinceLastRecall * 0.1))
      if (Math.abs(newDecay - memory.decayScore) > 0.01) {
        await memory.update({ decayScore: newDecay })
        updated++
      }
    }
    return { updated }
  }

  async _getRecentSessions(limit = 3) {
    const summaries = await SessionSummary.findAll({
      order: [['createdAt', 'DESC']],
      limit: limit * 5
    })
    const seen = new Set()
    const result = []
    for (const summary of summaries) {
      if (seen.has(summary.sessionId)) continue
      seen.add(summary.sessionId)
      result.push(summary)
      if (result.length >= limit) break
    }
    return result
  }

  /**
   * P0：一次性历史回填 — 把已经存在的历史消息按 batchSize 分批摘要
   * - 不阻塞调用方，内部并发受限（默认 3 并发）
   * - 每个 session 走 summarizeNextBatch，幂等（已存在 range 跳过）
   * - LLM 失败不抛错，跳过该 batch 继续后续（保证不回填卡死）
   *
   * @param {{ batchSize?: number, minMessages?: number, concurrency?: number }} opts
   * @returns {Promise<{sessionsProcessed: number, summariesCreated: number, errors: number}>}
   */
  async backfillAll({ batchSize = 20, minMessages = batchSize, concurrency = 3 } = {}) {
    const sessions = await ChatHistory.findAll({
      attributes: ['sessionId'],
      group: ['sessionId'],
      raw: true
    })

    let summariesCreated = 0
    let errors = 0
    let sessionsProcessed = 0

    // 简单并发控制：N 个一组并行
    for (let i = 0; i < sessions.length; i += concurrency) {
      const slice = sessions.slice(i, i + concurrency)
      const results = await Promise.allSettled(slice.map(async ({ sessionId }) => {
        let sessionSummaries = 0
        // 每个 session 持续调用 summarizeNextBatch 直到没新摘要
        // ponytail: 单 session 内串行，避免同一 session 多 batch 并发争抢
        // 上限 1000 batch / session 防止异常循环
        for (let guard = 0; guard < 1000; guard++) {
          try {
            const summary = await this.summarizeNextBatch(sessionId, { batchSize, minMessages })
            if (!summary) break
            sessionSummaries++
          } catch (err) {
            console.warn(`[MemoryTierService.backfillAll] ${sessionId} 第 ${guard + 1} batch 失败:`, err.message)
            errors++
            break
          }
        }
        sessionsProcessed++
        return sessionSummaries
      }))
      for (const r of results) {
        if (r.status === 'fulfilled') summariesCreated += r.value
      }
    }

    console.log(`[MemoryTierService.backfillAll] 完成: ${summariesCreated} 条新摘要 / ${sessionsProcessed} 会话 / ${errors} 错误`)
    return { sessionsProcessed, summariesCreated, errors }
  }
}

const instance = new MemoryTierService()
module.exports = instance
module.exports.MemoryTierService = MemoryTierService
