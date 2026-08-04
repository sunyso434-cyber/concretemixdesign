const SessionService = require('../db/services/SessionService')
const agentMemoryService = require('../services/AgentMemoryService')
const { classifyError } = require('./errorClassifier')

function createAgentExecutor({ getOrchestratorForSession, getOrchestrator, agentMemorySvc = agentMemoryService, sessionSvc = SessionService, lockTimeoutMs = 120000 }) {
  const sessionAgents = new Map()
  let globalFallback = null

  function setGlobalFallback(o) { globalFallback = o }

  function getSessionOrchestrator(sessionId) { return sessionAgents.get(sessionId)?.orchestrator ?? null }
  function isSessionRunning(sessionId) { return !!sessionAgents.get(sessionId)?.running }

  function ensureUserMessage({ sessionId, content, workspacePath, sink, requestId }) {
    // fire-and-forget（spec 真相 12）：会话创建 + AI 标题 + 缓存失效 + 广播，不阻塞 run
    ;(async () => {
      try {
        const { created, session } = await sessionSvc.ensureSession({ sessionId, sessionName: null, workspacePath })
        const currentName = session?.sessionName || ''
        const isDefaultName = (n) => !n || n.startsWith('新会话-') || n.startsWith('新对话 ')
          || /^对话 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(n) || /^对话 \d{2}-\d{2} \d{2}:\d{2}$/.test(n)
        if (!(created || isDefaultName(currentName))) return
        let sessionName = null
        try {
          const ag = await getOrchestrator() // 全局单例（与现状 agentHandler.js:461 语义一致）
          if (ag?.deepseekService) {
            const prompt = `请从以下用户消息中提取关键信息，生成一个简短的会话标题（不超过20个字符）。\n要求：\n1. 保留核心意图\n2. 去除语气词和无关信息\n3. 如果包含具体参数（如强度等级、材料名称），优先保留\n4. 只返回标题文本，不要添加引号或其他格式\n\n用户消息：${content.trim()}`
            sessionName = (await ag.deepseekService.invoke(prompt)).trim().substring(0, 20)
          }
        } catch (_) {}
        if (!sessionName) sessionName = [...content.trim()].slice(0, 15).join('') || '新会话'
        await sessionSvc.ensureSession({ sessionId, sessionName, workspacePath })
        if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
        sink?.send('agent:sessionUpdated', { sessionId, sessionName })
      } catch (_) { /* 标题非关键路径 */ }
    })()
  }

  async function saveUserMessage({ sessionId, role, content, metadata, stopReason, workspacePath, sink, requestId }) {
    if (!sessionId) return { success: false, error: 'sessionId is required' }
    if (role && !['user', 'assistant', 'system', 'tool'].includes(role)) return { success: false, error: `invalid role: ${role}` }
    try {
      await agentMemorySvc.saveMessage({ sessionId, role, content, metadata, stopReason }) // 消息必须落库
      if (role === 'user' && content) ensureUserMessage({ sessionId, content, workspacePath, sink, requestId })
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  }

  async function runAgentSession({ sessionId, requestId, message, mode, attachments, sink, persistUserMessage }) {
    if (persistUserMessage) {
      const wsPath = global.workspaceManager?.current()?.path ?? null
      await saveUserMessage({ sessionId, role: 'user', content: message, workspacePath: wsPath, sink, requestId }) // 远程路径：run 负责落库
    }
    const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const lock = sessionAgents.get(sessionId)
    if (lock && lock.running) {
      if (Date.now() - lock.startedAt > lockTimeoutMs) lock.running = false
      else return { success: false, error: '该会话已有任务在执行，请稍等' }
    }
    try {
      const ag = await getOrchestratorForSession(sessionId)
      if (!ag) return { success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' }
      sessionAgents.set(sessionId, { orchestrator: ag, running: true, startedAt: Date.now(), requestId: reqId })
      const result = await ag.run({ sessionId, message, mode: mode || 'auto', webContents: sink, attachments: Array.isArray(attachments) ? attachments : [] })
      return { success: true, result }
    } catch (error) {
      const classified = classifyError(error, { callSite: 'agentExecutor.runAgentSession', sessionId, requestId: reqId })
      try { sink?.send('agent:progress', { type: 'error', error: classified, sessionId, requestId: reqId }) } catch (_) {}
      return { success: false, error: classified }
    } finally {
      const s = sessionAgents.get(sessionId)
      if (s) { s.orchestrator = null; s.running = false; s.startedAt = 0 }
    }
  }

  // P0 断点续跑：续跑会话（B-1 命门）
  // - 不落库用户消息（无新用户消息）
  // - 不传 message/attachments（UnifiedStrategy.execute 内部用 mode='resume' 分支处理）
  // - 锁检查同 runAgentSession
  async function resumeAgentSession({ sessionId, requestId, sink }) {
    if (!sessionId) return { success: false, error: 'sessionId is required' }
    const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const lock = sessionAgents.get(sessionId)
    if (lock && lock.running) {
      if (Date.now() - lock.startedAt > lockTimeoutMs) lock.running = false
      else return { success: false, error: '该会话已有任务在执行，请稍等' }
    }
    try {
      const ag = await getOrchestratorForSession(sessionId)
      if (!ag) return { success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' }
      sessionAgents.set(sessionId, { orchestrator: ag, running: true, startedAt: Date.now(), requestId: reqId })
      // mode='resume'：UnifiedStrategy.execute 内部恢复 todo 快照 + 追加续跑指令消息
      const result = await ag.run({ sessionId, mode: 'resume', webContents: sink, attachments: [] })
      return { success: true, result }
    } catch (error) {
      const classified = classifyError(error, { callSite: 'agentExecutor.resumeAgentSession', sessionId, requestId: reqId })
      try { sink?.send('agent:progress', { type: 'error', error: classified, sessionId, requestId: reqId }) } catch (_) {}
      return { success: false, error: classified }
    } finally {
      const s = sessionAgents.get(sessionId)
      if (s) { s.orchestrator = null; s.running = false; s.startedAt = 0 }
    }
  }

  function confirm({ sessionId, confirmed, args }) {
    const s = sessionId ? sessionAgents.get(sessionId) : null
    if (s?.orchestrator?.resolveConfirmation) { s.orchestrator.resolveConfirmation(confirmed, args); return { success: true } }
    if (globalFallback?.resolveConfirmation) { globalFallback.resolveConfirmation(confirmed, args); return { success: true } }
    return { success: true }
  }
  function pause({ sessionId }) { sessionAgents.get(sessionId)?.orchestrator?.pause(); return { success: true } }
  function resume({ sessionId }) { sessionAgents.get(sessionId)?.orchestrator?.resume(); return { success: true } }
  function abort({ sessionId }) {
    const s = sessionId ? sessionAgents.get(sessionId) : null
    if (s?.orchestrator) s.orchestrator.abort()
    else if (globalFallback?.abort) globalFallback.abort()
    return { success: true }
  }

  // 批 B Task 1.9：steer/followUp 入队（仅 agent 运行时有效，orchestrator 在 finally 置 null）
  function steer({ sessionId, msg }) {
    const orch = sessionId ? sessionAgents.get(sessionId)?.orchestrator : null
    if (orch?.steer) { orch.steer(msg); return { success: true } }
    return { success: false, error: 'agent 未运行，无法插话' }
  }
  function followUp({ sessionId, msg }) {
    const orch = sessionId ? sessionAgents.get(sessionId)?.orchestrator : null
    if (orch?.followUp) { orch.followUp(msg); return { success: true } }
    return { success: false, error: 'agent 未运行，无法追加任务' }
  }

  return { runAgentSession, resumeAgentSession, saveUserMessage, getSessionOrchestrator, isSessionRunning, confirm, pause, resume, abort, steer, followUp, sessionAgents, setGlobalFallback }
}
module.exports = { createAgentExecutor }
