const MemoryTierService = require('../../services/MemoryTierService')
const LearningService = require('../../services/LearningService')
const AgentMemoryService = require('../../services/AgentMemoryService')
const { ChatHistory, sequelize } = require('../../db/database')

async function searchRawMessages(query, limit) {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return []

  let rawIds = []
  try {
    const ftsRaw = await sequelize.query(
      `SELECT rowid FROM chat_history_fts WHERE chat_history_fts MATCH ? LIMIT ?`,
      { replacements: [normalizedQuery, limit], type: sequelize.QueryTypes.SELECT }
    )
    rawIds = ftsRaw.map(r => r.rowid)
  } catch (err) {
    const escaped = normalizedQuery.replace(/[%_\\]/g, '\\$&')
    const likeRows = await sequelize.query(
      `SELECT id FROM chat_history WHERE content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`,
      { replacements: [`%${escaped}%`, limit], type: sequelize.QueryTypes.SELECT }
    )
    rawIds = likeRows.map(r => r.id)
  }

  if (rawIds.length === 0) return []

  const messages = await ChatHistory.findAll({
    where: { id: rawIds },
    order: [['id', 'ASC']],
    limit
  })
  return messages.map(m => ({
    sessionId: m.sessionId,
    role: m.role,
    content: m.content?.slice(0, 300),
    createdAt: m.createdAt
  }))
}

async function recallSession(args, context = {}) {
  const { query, topK = 5, toolName } = args
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) {
    return { success: false, error: 'query 不能为空', summaries: [], rawMessages: [], failures: [], corrections: [] }
  }

  const recalled = await MemoryTierService.recall(normalizedQuery, { topK })
  const rawMessages = await searchRawMessages(normalizedQuery, Math.max(10, topK))

  // P1：接入失败教训 + 老板的修正记录
  // - findFailurePatterns: 按工具名 + 关键词从 CorrectionRule 表捞失败案例（context 字段含 skillName/args）
  // - findSimilarCorrections: 按关键词 BM25 找老板手动纠正过的规则
  let failures = []
  let corrections = []
  try {
    failures = await LearningService.findFailurePatterns(toolName || '', normalizedQuery)
  } catch (err) {
    console.warn('[recallSession] findFailurePatterns 失败:', err.message)
  }
  try {
    corrections = await AgentMemoryService.findSimilarCorrections(normalizedQuery, toolName || null, 3)
  } catch (err) {
    console.warn('[recallSession] findSimilarCorrections 失败:', err.message)
  }

  return {
    success: true,
    summaries: recalled,
    rawMessages,
    failures,
    corrections
  }
}

module.exports = {
  name: 'recall_session',
  category: '记忆',
  description: '按关键词检索历史对话摘要与原文片段',
  execute: recallSession,
  services: [],
  parameters: {
    query: {
      type: 'string',
      description: '检索关键词',
      required: true
    },
    topK: {
      type: 'integer',
      description: '返回结果数量，默认 5',
      required: false,
      default: 5
    },
    toolName: {
      type: 'string',
      description: '可选的当前工具名，用于检索同类失败教训',
      required: false,
      default: null
    }
  }
}
