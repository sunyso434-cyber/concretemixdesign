// agentHandler 会话管理 IPC 域（从 agentHandler.js 拆分，优化项 2，行为不变）
// 由主文件 registerAgentHandlers 调用：registerSessionIpc(ipcMain, deps)
// deps: { executor, agentMemoryService, log }
// 拆分原则：仅移动注册闭包，channel 名、参数、返回结构原样保留。
function registerSessionIpc(ipcMain, deps) {
  const { executor, agentMemoryService, log } = deps

  ipcMain.handle('agent:listSessions', async () => {
    const { ChatHistory, ChatSession } = require('../db/database')
    const { fn, col, literal } = require('sequelize')
    // 取最近 50 个 sessionId
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

    // 批量查 sessionName
    const sessionIds = rows.map(r => r.sessionId)
    const sessions = await ChatSession.findAll({
      where: { sessionId: sessionIds },
      raw: true
    })
    const nameMap = Object.fromEntries(sessions.map(s => [s.sessionId, s.sessionName]))

    return {
      success: true,
      sessions: rows.map(r => ({
        sessionId: r.sessionId,
        lastActivity: r.lastActivity,
        sessionName: nameMap[r.sessionId] || null
      }))
    }
  })

  // Task 2.15b: 按工作区分组列出所有会话
  ipcMain.handle('agent:listSessionsGrouped', async () => {
    if (!global.chatHistorySync) {
      return { workspaces: [], unclassified: [] }
    }
    return await global.chatHistorySync.listSessionsGrouped()
  })

  ipcMain.handle('agent:getSessionMessages', async (_event, { sessionId, before }) => {
    const messages = await agentMemoryService.getHistory(sessionId, { limit: 20, before })
    // 剥离 metadata.timeline（大对象，含 reasoning + tool 结果）
    // 历史消息切回时不回放思考过程，只显示纯文本（DB 仍保留 timeline，需要时可单独查询）
    // 流式过程中的 timeline 来自 state.agent.timeline，不受影响
    const slimMessages = messages.map(m => {
      if (!m.metadata) return m
      const { timeline, ...restMetadata } = m.metadata
      return { ...m, metadata: restMetadata }
    })
    // v0.9.x：附带 LLM 配置的上下文上限（圆环分母；配置存储可能是字符串，须 Number()）
    let contextLimit = 200000
    try {
      const activeCfg = await deps.getActiveLlmConfig()
      const cl = Number(activeCfg && activeCfg.contextLimit)
      if (Number.isFinite(cl) && cl > 0) contextLimit = cl
    } catch (_) {}
    return { success: true, messages: slimMessages, contextLimit }
  })

  ipcMain.handle('agent:deleteSession', async (_event, { sessionId }) => {
    await agentMemoryService.deleteSession(sessionId)
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    // 清理工具结果缓存
    try {
      const ToolResultStore = require('../agent/ToolResultStore')
      const store = new ToolResultStore()
      store.clear(sessionId)
    } catch (_) {}
    return { success: true }
  })

  ipcMain.handle('agent:archiveSession', async (_event, { sessionIds, archived }) => {
    const { ChatSession } = require('../db/database')
    const { applyArchive } = require('./archiveSessionCore')
    // M0-2：isRunning 走 executor.isSessionRunning（会话运行状态由 executor 的 sessionAgents 维护）
    const isRunning = (sid) => executor.isSessionRunning(sid)
    const result = await applyArchive({ sessionIds, archived, isRunning, ChatSession })
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    try {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send('agent:sessionUpdated', { archived: !!archived })
      }
    } catch { /* 忽略 send 失败 */ }
    return { success: true, ...result }
  })

  ipcMain.handle('agent:duplicateSession', async (_event, { sessionId }) => {
    const result = await agentMemoryService.duplicateSession(sessionId)
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true, sessionId: result.sessionId, sessionName: result.sessionName }
  })

  ipcMain.handle('agent:createSession', async (_event, { sessionId, sessionName }) => {
    // v9.0.0 补充21：改为调用 SessionService.ensureSession
    // 旧行为：立即写入默认时间戳标题。新行为：仅当调用方显式传 sessionName（非 null/undefined）时创建，否则保留空标题等首条消息摘要。
    // 旧渲染端 createSession 已不再调用本 IPC（首条消息才落库），保留 handler 仅作向后兼容。
    const SessionService = require('../db/services/SessionService')
    const currentWorkspacePath = global.workspaceManager ? global.workspaceManager.current()?.path : null
    let finalName = sessionName
    if (finalName === undefined) {
      // 显式未指定 → 用历史兜底（兼容旧调用方）
      finalName = `新对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
    }
    // null 透传：保留空标题，由首条消息触发 AI 摘要生成
    await SessionService.ensureSession({
      sessionId,
      sessionName: finalName,
      workspacePath: currentWorkspacePath
    })
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true }
  })

  // v9.0.0 补充21：渲染端主动丢弃空会话（用户切换/关闭时清理）
  ipcMain.handle('agent:discardSession', async (_event, { sessionId }) => {
    try {
      const SessionService = require('../db/services/SessionService')
      const result = await SessionService.discardSessionIfEmpty(sessionId)
      if (result.discarded && global.chatHistorySync?.invalidateGroupedCache) {
        global.chatHistorySync.invalidateGroupedCache()
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // v9.0.0 补充21：欢迎页获取最近会话列表（含消息数 + 工作区路径）
  ipcMain.handle('agent:listRecentSessions', async (_event, { limit = 10 } = {}) => {
    try {
      const SessionService = require('../db/services/SessionService')
      const sessions = await SessionService.listRecentSessionsWithMeta(limit)
      return { success: true, sessions }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agent:getSessionInfo', async (_event, { sessionId }) => {
    const { ChatSession } = require('../db/database')
    const session = await ChatSession.findOne({ where: { sessionId } })
    return session ? {
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      workspacePath: session.workspacePath,
      lastActivity: session.lastActivity,
      archived: !!session.archived
    } : null
  })

  ipcMain.handle('agent:renameSession', async (_event, { sessionId, sessionName }) => {
    const { ChatSession } = require('../db/database')
    await ChatSession.update(
      { sessionName },
      { where: { sessionId } }
    )
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true }
  })

  ipcMain.handle('agent:clearAllMemory', async () => {
    const { ChatHistory, ChatSession, CorrectionRule, SessionSummary, PreferenceSuggestion } = require('../db/database')
    // 注意：user_preferences 表已在阶段 B 迁移中删除，不在此处引用
    await ChatHistory.destroy({ where: {}, truncate: true })
    await ChatSession.destroy({ where: {}, truncate: true })  // 清空会话表
    await CorrectionRule.destroy({ where: {}, truncate: true })
    // P1：同步清 L1 归档记忆 + 自动学习建议，避免旧会话数据被召回
    try { await SessionSummary.destroy({ where: {}, truncate: true }) } catch (err) {
      console.warn('[agent:clearAllMemory] 清 SessionSummary 失败:', err.message)
    }
    try { await PreferenceSuggestion.destroy({ where: {}, truncate: true }) } catch (err) {
      console.warn('[agent:clearAllMemory] 清 PreferenceSuggestion 失败:', err.message)
    }
    // P1：清工作区里的 chat-history 归档目录（所有工作区扫描一遍）
    const sync = global.chatHistorySync
    if (sync && typeof sync.removeAllArchives === 'function') {
      try { await sync.removeAllArchives() } catch (err) {
        console.warn('[agent:clearAllMemory] 清工作区归档失败:', err.message)
      }
    }
    return { success: true }
  })

  // P0：一次性历史回填 — 给老板一个手动触发按钮
  ipcMain.handle('agent:backfillMemory', async () => {
    const MemoryTierService = require('../services/MemoryTierService')
    const result = await MemoryTierService.backfillAll({ batchSize: 20, minMessages: 20, concurrency: 3 })
    return { success: true, ...result }
  })

  ipcMain.handle('agent:saveCorrection', async (_event, correction) => {
    try {
      const LearningService = require('../services/LearningService')
      await LearningService.saveCorrection(correction)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerSessionIpc }