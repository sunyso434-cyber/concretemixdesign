'use strict'

// RemoteSessionApi：远程会话管理（R7）。
//
// 薄封装现有会话逻辑，复用 SessionService / ChatSession / ChatHistory 模型，
// 行为与桌面端 agentHandler 会话 handler 一致：
//   - agent:listSessions        → 最近 50 个会话（lastActivity 按最后消息时间，sessionName 批量补）
//   - agent:getSessionMessages  → 按时间倒序取最新 20 条、反转正序、剥离 metadata.timeline
//   - agent:createSession       → 复用 SessionService.ensureSession（sessionName 缺省给「新对话」兜底）
//   - agent:deleteSession       → 清理 ChatSession + ChatHistory + L1 SessionSummary + ToolResultStore 缓存
//   - agent:archiveSession      → 复用 archiveSessionCore.applyArchive（批量、跳过运行中会话）
//   - agent:renameSession       → ChatSession.update 改名
//
// 响应约定（R6 一致）：请求的同一通道回 { requestId, success, ...payload }；
// requestId 缺省时生成（与 agentHandler agent:run 同格式 req_<ts>_<rand>）。
//
// 纯 Node，不 require electron；模型/服务懒加载（require 路径与桌面端一致，便于 jest mock）。

// 生成 requestId（与 agentHandler agent:run 同格式）
function genRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

class RemoteSessionApi {
  /**
   * WS 请求处理器（R5 约定签名，RemoteServer 分发：handleMessage(ws, msg)）。
   * @param {object} ws  请求方目标（wrapWs 包装，具备 send(channel, payload)）
   * @param {object} msg 请求消息 { type: '<通道>', ...payload }
   */
  async handleMessage(ws, msg) {
    const channel = msg && msg.type
    switch (channel) {
      case 'agent:listSessions': return this._handleListSessions(ws, msg)
      case 'agent:getSessionMessages': return this._handleGetSessionMessages(ws, msg)
      case 'agent:createSession': return this._handleCreateSession(ws, msg)
      case 'agent:deleteSession': return this._handleDeleteSession(ws, msg)
      case 'agent:archiveSession': return this._handleArchiveSession(ws, msg)
      case 'agent:renameSession': return this._handleRenameSession(ws, msg)
      default:
        // 正常流程不会到这（R5 白名单已过滤）；兜底，不抛错
        ws.send('error', { error: 'CHANNEL_NOT_ALLOWED' })
        return { success: false, error: 'CHANNEL_NOT_ALLOWED' }
    }
  }

  // 从 agentHandler 取共享 executor 单例（懒加载：与 RemoteAgentBridge 同款，失败返回 null）
  _resolveExecutor() {
    try {
      const agentHandler = require('../ipcHandlers/agentHandler')
      return typeof agentHandler.getExecutor === 'function' ? agentHandler.getExecutor() : null
    } catch (_) {
      return null
    }
  }

  // 与桌面端一致的缓存失效（electron 侧存在 global.chatHistorySync 时生效；测试/纯 Node 环境为空操作）
  _invalidateCache() {
    try { global.chatHistorySync?.invalidateGroupedCache?.() } catch (_) {}
  }

  /**
   * agent:listSessions — 最近 50 个会话。
   * 与 agentHandler.js 同名 handler 相同的查询结构：ChatHistory 按 sessionId 聚合出最后活动时间，
   * 再批量查 ChatSession 补 sessionName。
   */
  async _handleListSessions(ws, msg) {
    const { requestId } = msg || {}
    const reqId = requestId || genRequestId()
    try {
      const { ChatHistory, ChatSession } = require('../db/database')
      const { fn, col, literal } = require('sequelize')
      const rows = await ChatHistory.findAll({
        attributes: [
          'sessionId',
          [fn('MAX', col('createdAt')), 'lastActivity']
        ],
        group: ['sessionId'],
        order: [[literal('lastActivity'), 'DESC']],
        limit: 50,
        raw: true
      })
      const sessionIds = rows.map(r => r.sessionId)
      const sessions = await ChatSession.findAll({
        where: { sessionId: sessionIds },
        raw: true
      })
      const nameMap = Object.fromEntries(sessions.map(s => [s.sessionId, s.sessionName]))
      const list = rows.map(r => ({
        sessionId: r.sessionId,
        lastActivity: r.lastActivity,
        sessionName: nameMap[r.sessionId] || null
      }))
      ws.send('agent:listSessions', { requestId: reqId, success: true, sessions: list })
      return { success: true, sessions: list }
    } catch (err) {
      ws.send('agent:listSessions', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * agent:getSessionMessages — 取会话消息（最新 20 条，时间正序；可选 before 分页）。
   * 与 agentMemoryService.getHistory + agentHandler 同名 handler 相同：倒序取 N 条后反转，
   * 并剥离 metadata.timeline（不回放思考过程）。
   */
  async _handleGetSessionMessages(ws, msg) {
    const { sessionId, before, limit, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!sessionId) {
      ws.send('agent:getSessionMessages', { requestId: reqId, success: false, error: '缺少 sessionId' })
      return { success: false, error: '缺少 sessionId' }
    }
    try {
      const { ChatHistory } = require('../db/database')
      const { Op } = require('sequelize')
      const where = { sessionId }
      if (before) where.createdAt = { [Op.lt]: new Date(before) }
      const rows = await ChatHistory.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: limit || 20
      })
      rows.reverse() // DESC 取最新 N 条后反转回时间正序
      const messages = rows.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
        metadata: m.metadata,
        createdAt: m.createdAt
      })).map(m => {
        if (!m.metadata) return m
        const { timeline, ...restMetadata } = m.metadata
        return { ...m, metadata: restMetadata }
      })
      ws.send('agent:getSessionMessages', { requestId: reqId, success: true, messages })
      return { success: true, messages }
    } catch (err) {
      ws.send('agent:getSessionMessages', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * agent:createSession — 复用 SessionService.ensureSession。
   * 与 agentHandler 同名 handler 相同：sessionName 为 undefined 时给「新对话」兜底标题，
   * null 透传（保留空标题等首条消息摘要）；远程无当前工作区，workspacePath 传 null。
   */
  async _handleCreateSession(ws, msg) {
    const { sessionId, sessionName, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!sessionId) {
      ws.send('agent:createSession', { requestId: reqId, success: false, error: '缺少 sessionId' })
      return { success: false, error: '缺少 sessionId' }
    }
    try {
      const SessionService = require('../db/services/SessionService')
      let finalName = sessionName
      if (finalName === undefined) {
        // 显式未指定 → 用历史兜底（兼容旧调用方）
        finalName = `新对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
      }
      await SessionService.ensureSession({
        sessionId,
        sessionName: finalName,
        workspacePath: null
      })
      this._invalidateCache()
      ws.send('agent:createSession', { requestId: reqId, success: true })
      return { success: true }
    } catch (err) {
      ws.send('agent:createSession', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * agent:deleteSession — 清理会话及其消息。
   * 与桌面端行为一致：删 ChatSession + ChatHistory + L1 归档记忆（SessionSummary 按 session 隔离）+ ToolResultStore 缓存。
   * （工作区 chat-history 归档目录的删除依赖 electron 侧 global.chatHistorySync，远程薄封装不在此处理。）
   */
  async _handleDeleteSession(ws, msg) {
    const { sessionId, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!sessionId) {
      ws.send('agent:deleteSession', { requestId: reqId, success: false, error: '缺少 sessionId' })
      return { success: false, error: '缺少 sessionId' }
    }
    try {
      const { ChatSession, ChatHistory, SessionSummary } = require('../db/database')
      await ChatSession.destroy({ where: { sessionId } })
      await ChatHistory.destroy({ where: { sessionId } })
      // L1 归档记忆按 session 隔离，必须同步删（与 agentMemoryService.deleteSession 一致）
      try { await SessionSummary.destroy({ where: { sessionId } }) } catch (_) {}
      // 清理工具结果缓存（与 agentHandler agent:deleteSession 一致）
      try {
        const ToolResultStore = require('../agent/ToolResultStore')
        new ToolResultStore().clear(sessionId)
      } catch (_) {}
      this._invalidateCache()
      ws.send('agent:deleteSession', { requestId: reqId, success: true })
      return { success: true }
    } catch (err) {
      ws.send('agent:deleteSession', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * agent:archiveSession — 批量归档/恢复，复用 archiveSessionCore.applyArchive。
   * 与桌面端一致：归档（archived=true）时跳过正在运行的会话（executor.isSessionRunning），恢复不受限。
   */
  async _handleArchiveSession(ws, msg) {
    const { sessionIds, archived, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      ws.send('agent:archiveSession', { requestId: reqId, success: false, error: '缺少 sessionIds' })
      return { success: false, error: '缺少 sessionIds' }
    }
    try {
      const { ChatSession } = require('../db/database')
      const { applyArchive } = require('../ipcHandlers/archiveSessionCore')
      const executor = this._resolveExecutor()
      const isRunning = (sid) => !!(executor && typeof executor.isSessionRunning === 'function' && executor.isSessionRunning(sid))
      const result = await applyArchive({ sessionIds, archived, isRunning, ChatSession })
      this._invalidateCache()
      const resp = { requestId: reqId, success: true, ...result }
      ws.send('agent:archiveSession', resp)
      return resp
    } catch (err) {
      ws.send('agent:archiveSession', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * agent:renameSession — 改名（ChatSession.update）。
   * 与 agentHandler 同名 handler 相同：直接更新 sessionName。
   */
  async _handleRenameSession(ws, msg) {
    const { sessionId, sessionName, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!sessionId) {
      ws.send('agent:renameSession', { requestId: reqId, success: false, error: '缺少 sessionId' })
      return { success: false, error: '缺少 sessionId' }
    }
    try {
      const { ChatSession } = require('../db/database')
      await ChatSession.update(
        { sessionName },
        { where: { sessionId } }
      )
      this._invalidateCache()
      ws.send('agent:renameSession', { requestId: reqId, success: true })
      return { success: true }
    } catch (err) {
      ws.send('agent:renameSession', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }
}

module.exports = RemoteSessionApi
