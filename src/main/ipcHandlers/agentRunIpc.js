// agentHandler 运行控制 + Todo 计划 IPC 域（从 agentHandler.js 拆分，优化项 2，行为不变）
// 由主文件 registerAgentHandlers 调用：registerAgentRunIpc(ipcMain, deps)
// deps: { executor, agentMemoryService, skillExecutor(函数取当前值), log, logLogger, getDefaultSink }
// 拆分原则：仅移动注册闭包，channel 名、参数、返回结构原样保留。

function registerAgentRunIpc(ipcMain, deps) {
  const { executor, agentMemoryService, skillExecutor, log, logLogger, getDefaultSink } = deps

  ipcMain.handle('agent:run', async (event, { requestId, sessionId, message, mode, attachments }) => {
    // 生成 requestId（如渲染端未传）
    const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    log(`[AgentHandler] 🔵 agent:run 收到请求 sessionId=${sessionId} requestId=${reqId} 图片数=${Array.isArray(attachments) ? attachments.length : 0}`)

    // M0-2：锁检查 / Orchestrator 获取 / 执行 / 错误分类 / 锁释放 全部委托给 executor.runAgentSession
    // - sink 双角色：event.sender 既是事件发射器（.send），也是传给 Orchestrator 的 webContents
    // - persistUserMessage=false：渲染端已先 saveMessage，run 不再落库用户消息
    const result = await executor.runAgentSession({
      sessionId,
      requestId: reqId,
      message,
      mode,
      attachments,
      // R11(P1-1)：已接线共享 FanoutSink 时 sink 走 fanout（桌面 webContents 是目标 → 自扇出仍收到 + 手机也收到）；
      // 未接线（executorDefaultSink 为 null）时回退 event.sender，桌面行为与 M0 一致
      sink: getDefaultSink() || event.sender,
      persistUserMessage: false
    })
    const errSummary = result?.error
      ? (typeof result.error === 'object' ? (result.error.code || '') : result.error)
      : ''
    log(`[AgentHandler] 🚀 agent:run 完成 requestId=${reqId} success=${result?.success} error=${errSummary}`)
    return result
  })

  ipcMain.handle('agent:pause', async (_event, { requestId, sessionId }) => {
    return executor.pause({ sessionId })
  })

  // v0.9.x 输出优化：单条消息赞/踩反馈（写 chat_history.metadata.feedback）
  ipcMain.handle('agent:setMessageFeedback', async (_event, { messageId, feedback }) => {
    return agentMemoryService.setMessageFeedback({ messageId, feedback })
  })

  ipcMain.handle('agent:resume', async (_event, { requestId, sessionId }) => {
    return executor.resume({ sessionId })
  })

  ipcMain.handle('agent:abort', async (_event, { requestId, sessionId }) => {
    // M0-2：委托 executor.abort（sessionId 优先，无 sessionId / 非运行会话走全局 fallback，与 M0-1 评审一致）
    return executor.abort({ sessionId })
  })

  // === 批 B Task 1.9：steer/followUp 插话 IPC ===
  // steer：agent 运行中插入新指令，下一轮 LLM 看到（入 steeringQueue）
  // followUp：当前任务完成后自动接着干新任务（入 followUpQueue，完成判定时 drain + step 重置）
  ipcMain.handle('agent:steer', async (_event, { sessionId, msg } = {}) => {
    if (!sessionId) return { success: false, error: '缺少 sessionId' }
    if (!msg) return { success: false, error: '缺少插话内容' }
    return executor.steer({ sessionId, msg })
  })
  ipcMain.handle('agent:follow_up', async (_event, { sessionId, msg } = {}) => {
    if (!sessionId) return { success: false, error: '缺少 sessionId' }
    if (!msg) return { success: false, error: '缺少追加任务内容' }
    return executor.followUp({ sessionId, msg })
  })
  // Task 3.1（Alt+Enter 立即插话）：校验后委托 executor.steerImmediate（state==='running' 时 steer + 中断 + 取消 ask_user）
  ipcMain.handle('agent:steer_immediate', async (_event, { sessionId, msg } = {}) => {
    if (!sessionId) return { success: false, error: '缺少 sessionId' }
    if (!msg) return { success: false, error: '缺少插话内容' }
    return executor.steerImmediate({ sessionId, msg })
  })

  // === P0 断点续跑（Task 1.6）：3 个 IPC ===
  // 流程：detect-crash-window → 若 needAsk 弹窗 → rerun-unpaired-tools（可选）→ resume-from-checkpoint

  // 1. 检测崩溃窗口：返回最后一条 assistant 的未配对 tool_calls
  ipcMain.handle('agent:detect-crash-window', async (_event, { sessionId } = {}) => {
    if (!sessionId) return { success: false, error: '缺少 sessionId', needAsk: false, unpairedToolCalls: [] }
    try {
      const result = await agentMemoryService.detectCrashWindow(sessionId)
      log(`[AgentHandler] 🔍 detect-crash-window sessionId=${sessionId} needAsk=${result.needAsk} unpairedCount=${result.unpairedToolCalls?.length || 0}`)
      return { success: true, ...result }
    } catch (e) {
      log(`[AgentHandler] detect-crash-window 失败: ${e.message}`)
      return { success: false, error: e.message, needAsk: false, unpairedToolCalls: [] }
    }
  })

  // 2. 串行重跑未配对 tool_calls（用户在弹窗选"是"时调用）
  ipcMain.handle('agent:rerun-unpaired-tools', async (_event, { sessionId, unpairedToolCalls } = {}) => {
    if (!sessionId) return { success: false, error: '缺少 sessionId', results: [] }
    if (!Array.isArray(unpairedToolCalls) || unpairedToolCalls.length === 0) {
      return { success: true, results: [] }
    }
    if (!skillExecutor()) {
      return { success: false, error: 'skillExecutor 未初始化', results: [] }
    }
    try {
      log(`[AgentHandler] 🔁 rerun-unpaired-tools sessionId=${sessionId} count=${unpairedToolCalls.length}`)
      const results = await agentMemoryService.rerunUnpairedToolCalls(sessionId, unpairedToolCalls, { skillExecutor: skillExecutor() })
      log(`[AgentHandler] ✅ rerun-unpaired-tools 完成 sessionId=${sessionId} results=${results.length}`)
      return { success: true, results }
    } catch (e) {
      log(`[AgentHandler] rerun-unpaired-tools 失败: ${e.message}`)
      return { success: false, error: e.message, results: [] }
    }
  })

  // 3. 续跑：调 executor.resumeAgentSession（内部走 UnifiedStrategy.execute mode='resume' 分支）
  ipcMain.handle('agent:resume-from-checkpoint', async (event, { requestId, sessionId } = {}) => {
    if (!sessionId) return { success: false, error: '缺少 sessionId' }
    const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    log(`[AgentHandler] 🔄 resume-from-checkpoint sessionId=${sessionId} requestId=${reqId}`)
    const result = await executor.resumeAgentSession({
      sessionId,
      requestId: reqId,
      sink: getDefaultSink() || event.sender
    })
    const errSummary = result?.error
      ? (typeof result.error === 'object' ? (result.error.code || '') : result.error)
      : ''
    log(`[AgentHandler] 🚀 resume-from-checkpoint 完成 requestId=${reqId} success=${result?.success} error=${errSummary}`)
    return result
  })

  // === Todo 计划面板（2026-07-08）：前端 mount 时拉取当前会话最新清单 ===
  // 复用 skill 的 list action，不另写查询代码
  ipcMain.handle('todo:list', async (_event, { sessionId } = {}) => {
    if (!sessionId) {
      return { success: false, error: '缺少 sessionId', todos: [], total: 0, completed: 0 }
    }
    try {
      const todoManage = require('../skills/todo-manage')
      return await todoManage.execute(
        { action: 'list' },
        { sessionId, logger: logLogger }
      )
    } catch (e) {
      log(`[AgentHandler] todo:list 失败: ${e.message}`)
      return { success: false, error: e.message, todos: [], total: 0, completed: 0 }
    }
  })

  // === 阶段 3 任务 3.3：计划审批三个 IPC（PlanApprovalModal 三键对应） ===
  // 确认 → todo:confirm-plan → approve_plan（清除 pendingApproval，计划生效）
  // 修改 → todo:replace-plan → replace_plan（编辑后数组清空重建，清除 pendingApproval）
  // 取消 → todo:clear → clear（清空计划）
  // 注：todo_manage.execute 内部已 _persistCheckpoint 落库，成功即持久化完成
  ipcMain.handle('todo:confirm-plan', async (_event, { sessionId } = {}) => {
    if (!sessionId) {
      return { success: false, error: '缺少 sessionId', todos: [], total: 0, completed: 0 }
    }
    try {
      const todoManage = require('../skills/todo-manage')
      return await todoManage.execute(
        { action: 'approve_plan' },
        { sessionId, logger: logLogger }
      )
    } catch (e) {
      log(`[AgentHandler] todo:confirm-plan 失败: ${e.message}`)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('todo:replace-plan', async (_event, { sessionId, steps } = {}) => {
    if (!sessionId) {
      return { success: false, error: '缺少 sessionId', todos: [], total: 0, completed: 0 }
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return { success: false, error: '缺少计划步骤 steps', todos: [], total: 0, completed: 0 }
    }
    try {
      const todoManage = require('../skills/todo-manage')
      return await todoManage.execute(
        { action: 'replace_plan', steps },
        { sessionId, logger: logLogger }
      )
    } catch (e) {
      log(`[AgentHandler] todo:replace-plan 失败: ${e.message}`)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('todo:clear', async (_event, { sessionId } = {}) => {
    if (!sessionId) {
      return { success: false, error: '缺少 sessionId', todos: [], total: 0, completed: 0 }
    }
    try {
      const todoManage = require('../skills/todo-manage')
      return await todoManage.execute(
        { action: 'clear' },
        { sessionId, logger: logLogger }
      )
    } catch (e) {
      log(`[AgentHandler] todo:clear 失败: ${e.message}`)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('agent:saveMessage', async (_event, { sessionId, role, content, metadata, stopReason }) => {
    // M0-2：整体委托 executor.saveUserMessage
    // - 内部先 await saveMessage 落库，再 fire-and-forget ensureSession（建会话 + AI 标题 + 缓存失效 + 广播）
    // - workspacePath 用当前工作区路径（与原逻辑一致）
    // - sink 双角色：_event.sender 既是事件发射器，也是 webContents
    return executor.saveUserMessage({
      sessionId,
      role,
      content,
      metadata,
      stopReason,
      workspacePath: global.workspaceManager?.current()?.path ?? null,
      sink: _event.sender
    })
  })

  // v9.1.0 ask_user：按 sessionId 路由到对应会话的 Orchestrator.resolveConfirmation
  // M0-2：委托 executor.confirm（sessionId 优先，无 sessionId / 非运行会话走全局 fallback，与原行为一致）
  ipcMain.handle('agent:confirm', async (_event, { sessionId, confirmed, args }) => {
    return executor.confirm({ sessionId, confirmed, args })
  })
}

module.exports = { registerAgentRunIpc }