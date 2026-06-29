// src/main/db/services/SessionService.js
// v9.0.0 补充21：会话业务封装
// 单一职责：
//   1. ensureSession — 如果 sessionId 在 DB 中不存在则创建（用于"首条消息才落库"）
//   2. discardSessionIfEmpty — 如果 session 没有任何消息则从 DB 中删除（用于"未发送消息的会话不留痕"）
//   3. listRecentSessionsWithMeta — 取最近 N 个会话的元数据（含消息数、工作区路径），供欢迎页展示
//
// 此前逻辑散落在 agentHandler.js 的 `agent:createSession` 和 `agent:saveMessage` 内，
// 难以复用且难以测试；本服务统一封装。

const { ChatSession, ChatHistory } = require('../database')

/**
 * 确保 session 存在；若不存在则 upsert 创建。
 *
 * @param {Object} args
 * @param {string} args.sessionId
 * @param {string|null} [args.sessionName=null] - 标题；首次创建为空，让后端 AI 摘要生成
 * @param {string|null} [args.workspacePath=null]
 * @returns {Promise<{created: boolean, session: object}>} created 表示是否新建
 */
async function ensureSession({ sessionId, sessionName = null, workspacePath = null }) {
  if (!sessionId) throw new Error('[SessionService.ensureSession] sessionId is required')
  const existing = await ChatSession.findOne({ where: { sessionId } })
  if (existing) {
    // 存在则只更新 lastActivity 和 workspacePath（workspacePath 可能因为切换工作区而改变）
    const updates = { lastActivity: new Date() }
    if (workspacePath !== null) updates.workspacePath = workspacePath
    await ChatSession.update(updates, { where: { sessionId } })
    const refreshed = await ChatSession.findOne({ where: { sessionId } })
    return { created: false, session: refreshed }
  }
  // 不存在则创建
  await ChatSession.upsert({
    sessionId,
    sessionName,
    workspacePath,
    lastActivity: new Date()
  })
  const created = await ChatSession.findOne({ where: { sessionId } })
  return { created: true, session: created }
}

/**
 * 若 session 在 DB 中存在且没有任何消息（ChatHistory 计数为 0），则从 DB 删除。
 * 用于"未发送消息的会话不写库"：用户切换会话/关闭应用时清理。
 *
 * @param {string} sessionId
 * @returns {Promise<{discarded: boolean, reason: string}>}
 */
async function discardSessionIfEmpty(sessionId) {
  if (!sessionId) return { discarded: false, reason: 'no-session-id' }
  const session = await ChatSession.findOne({ where: { sessionId } })
  if (!session) return { discarded: false, reason: 'not-in-db' }
  const count = await ChatHistory.count({ where: { sessionId } })
  if (count > 0) return { discarded: false, reason: 'has-messages' }
  await ChatSession.destroy({ where: { sessionId } })
  return { discarded: true, reason: 'empty' }
}

/**
 * 取最近 N 个会话的元数据，含消息数（用于欢迎页展示）。
 *
 * @param {number} [limit=10]
 * @returns {Promise<Array<{sessionId, sessionName, workspacePath, createdAt, lastActivity, messageCount}>>}
 */
async function listRecentSessionsWithMeta(limit = 10) {
  const sessions = await ChatSession.findAll({
    order: [['lastActivity', 'DESC']],
    limit
  })
  // 批量查每个 session 的消息数（避免 N+1：先 IN 查出所有相关 chat_history，再聚合）
  const sessionIds = sessions.map(s => s.sessionId)
  if (sessionIds.length === 0) return []
  const counts = await ChatHistory.findAll({
    attributes: ['sessionId', [ChatHistory.sequelize.fn('COUNT', '*'), 'count']],
    where: { sessionId: sessionIds },
    group: ['sessionId'],
    raw: true
  })
  const countMap = new Map(counts.map(c => [c.sessionId, parseInt(c.count, 10) || 0]))
  return sessions.map(s => ({
    sessionId: s.sessionId,
    sessionName: s.sessionName || '新会话',
    workspacePath: s.workspacePath || null,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    messageCount: countMap.get(s.sessionId) || 0
  }))
}

module.exports = {
  ensureSession,
  discardSessionIfEmpty,
  listRecentSessionsWithMeta,
}