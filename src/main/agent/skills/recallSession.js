const MemoryTierService = require('../../services/MemoryTierService')
const { SessionSummary } = require('../../db/database')
const { ChatHistory } = require('../../db/database')
const { sequelize } = require('../../db/database')
const { buildBM25, queryBM25 } = require('../../workspace/bm25')
const { Op } = require('sequelize')

/**
 * recall_session skill
 * 按关键词检索归档记忆 + 原始对话段落
 */
async function recallSession(args, context = {}) {
  const { query, topK = 5 } = args

  // 1. 走 MemoryTierService.recall（FTS5 + BM25 + decay）
  const recalled = await MemoryTierService.recall(query, { topK })

  // 2. 补充从 ChatHistory 的原始命中
  // ponytail: chat_history_fts 表可能不存在，FTS raw search 失败时只返回 summaries
  let rawMessages = []
  try {
    const ftsRaw = await sequelize.query(
      `SELECT rowid FROM chat_history_fts WHERE chat_history_fts MATCH ? LIMIT 10`,
      { replacements: [query], type: sequelize.QueryTypes.SELECT }
    )
    const rawIds = ftsRaw.map(r => r.rowid)
    if (rawIds.length > 0) {
      const messages = await ChatHistory.findAll({ where: { id: rawIds }, limit: 10 })
      rawMessages = messages.map(m => ({
        role: m.role, content: m.content?.slice(0, 300), createdAt: m.createdAt
      }))
    }
  } catch (_) {
    // chat_history_fts 表不存在，静默降级
  }

  return {
    success: true,
    summaries: recalled,
    rawMessages
  }
}

module.exports = {
  name: 'recall_session',
  category: '记忆',
  description: '按关键词检索历史对话摘要与原文（跨会话召回老板之前讨论过的内容）',
  execute: recallSession,
  services: [],
  parameters: {
    query: {
      type: 'string',
      description: '检索关键词（如"砂率"、"C30 配合比"、"上次报告"）',
      required: true
    },
    topK: {
      type: 'integer',
      description: '返回结果数（默认 5）',
      required: false,
      default: 5
    }
  }
}
