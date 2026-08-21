// UnifiedStrategy 辅助方法集（从 UnifiedStrategy.js 拆分，优化项 2，行为不变）
// 这些函数作为原型方法挂回 UnifiedStrategy 类（主文件 Object.assign）：
// _notifyProgress（前端进度推送）、_persistLastStep（断点续跑）、_cleanMessage（消息规整）、
// _extractRecentFilePaths（最近文件提取）、_autoCompactIfNeeded（自动压缩检查）。
// 依赖的数据库/技能模块均在方法内动态 require，无顶层副作用（便于测试环境 mock）。

  /**
   * 向渲染进程推送进度事件
   * 始终携带 sessionId，让前端能按会话路由，避免多会话并行时串流到当前焦点会话
   */
  function _notifyProgress(webContents, data) {
    if (webContents && !webContents.isDestroyed?.()) {
      try {
        webContents.send('agent:progress', { ...data, sessionId: this.sessionId })
      } catch (_) {}
    }
  }

  /**
   * 异步写 last_step 到 agent_checkpoint（断点续跑用）
   * - 不 await（主循环不阻塞；崩溃时 last_step 可能滞后 1 步，可接受——续跑以 messages 为准）
   * - 失败只 catch（DB 未就绪/测试环境静默跳过）
   * C-3 性能取舍：同步 await 每步多 5-20ms DB 延迟累积影响体验；异步写 last_step 滞后 1 步不影响正确性
   */
  function _persistLastStep(sessionId, step) {
    try {
      const { AgentCheckpoint } = require('../../db/database')
      if (!AgentCheckpoint) return
      AgentCheckpoint.upsert({
        sessionId,
        lastStep: step,
        updatedAt: new Date()
      }).catch(() => {})
    } catch (_) { /* DB 未就绪/测试环境 */ }
  }

  /**
   * 清理消息对象
   * ⚠️ DeepSeek thinking 模式硬性规定：
   * reasoning_content 只能出现在最后一条 assistant 消息中
   * 如果消息有 tool_calls（说明不是最后一条），必须剥离 reasoning_content，否则 API 400
   */
  function _cleanMessage(msg) {
    const cleaned = {
      role: msg.role,
      content: msg.content || null
    }
    // 只有无 tool_calls 的消息（最终回复）才能保留 reasoning_content
    if (msg.reasoning_content && !msg.tool_calls) {
      cleaned.reasoning_content = msg.reasoning_content
    }
    if (msg.tool_call_id) cleaned.tool_call_id = msg.tool_call_id
    if (msg.name) cleaned.name = msg.name
    if (msg.tool_calls) cleaned.tool_calls = msg.tool_calls
    return cleaned
  }

  /**
   * 从消息数组中提取最近 N 次文件操作的文件路径
   * 用于压缩后通知 AI 重新读取工作文件
   */
  function _extractRecentFilePaths(messages, maxCount = 5) {
    if (!Array.isArray(messages)) return []
    const FILE_SKILLS = new Set([
      'workspace_readPage', 'workspace_readRaw',
      'workspace_ingest', 'workspace_writeFile',
    ])
    const paths = []
    const seen = new Set()
    for (let i = messages.length - 1; i >= 0 && paths.length < maxCount; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const name = tc.function?.name
          if (name && FILE_SKILLS.has(name)) {
            try {
              const args = JSON.parse(tc.function.arguments)
              const filePath = args.wikiPath || args.filename || ''
              if (filePath && !seen.has(filePath)) {
                seen.add(filePath)
                paths.push({ skill: name, path: filePath })
              }
            } catch (_) {}
          }
        }
      }
    }
    return paths
  }

  /**
   * Layer 2: 自动压缩检查
   * 在消息水位 ≥ 78% 时自动压缩上下文
   * @param {Array} messages - 当前消息数组
   * @param {string} sessionId - 会话 ID
   * @param {number} tokenBudget - 当前 token 预算
   * @returns {Promise<{skipped: string}|{result, todoBackup}>}
   */
  async function _autoCompactIfNeeded(messages, sessionId, tokenBudget) {
    const now = Date.now()

    // 防抖：距上次压缩不足 3 分钟 → 跳过
    if (now - this._lastCompactionTime < 3 * 60 * 1000) {
      this._compactionSkipCount++
      return { skipped: 'throttled' }
    }

    // 熔断：连续 3 次压缩失败 → 永久停止自动压缩
    if (this._compactionFailureCount >= 3) {
      return { skipped: 'fused' }
    }

    // 估算当前 token
    const { estimateTokens } = require('../../../shared/utils/contextStats')
    const currentTokens = estimateTokens(messages)

    // 获取 contextLimit
    let contextLimit = 200000  // 兜底
    if (this.systemService && typeof this.systemService.getAgentConfig === 'function') {
      try {
        const cfg = await this.systemService.getAgentConfig()
        if (cfg && Number.isFinite(cfg.deepseekContextLimit)) {
          contextLimit = cfg.deepseekContextLimit
        }
      } catch (_) {}
    }

    const threshold = Math.floor(contextLimit * 0.78)
    if (currentTokens < threshold) {
      return { skipped: 'below_threshold' }
    }

    // === 到达触发点 ===

    // 备份 todo
    let todoBackup = { todos: [], total: 0, completed: 0 }
    try {
      const todoManage = require('../../skills/todo-manage')
      todoBackup = await todoManage.execute(
        { action: 'list' },
        { sessionId, logger: () => {} }
      )
      if (!todoBackup) todoBackup = { todos: [], total: 0, completed: 0 }
    } catch (_) {}

    // 提取最近访问的文件路径（压缩后通知 AI 重读）
    let recentFilePaths = []
    try {
      recentFilePaths = this._extractRecentFilePaths(messages, 5)
    } catch (_) {}

    // 调 compressContext（复用 DeepSeekService）
    const deepseek = this.deepseekService
    if (!deepseek || typeof deepseek.compressContext !== 'function') {
      return { skipped: 'no_deepseek' }
    }

    let result
    try {
      result = await deepseek.compressContext(messages, this._previousSummary || '')
    } catch (err) {
      this._compactionFailureCount++
      this._lastCompactionTime = now
      console.warn('[UnifiedStrategy] 自动压缩失败:', err.message)
      return { skipped: 'compression_failed' }
    }

    if (!result || !result.summary) {
      this._compactionFailureCount++
      this._lastCompactionTime = now
      return { skipped: 'compression_failed' }
    }

    // 成功：重置计数器
    this._compactionFailureCount = 0
    this._lastCompactionTime = now
    this._previousSummary = result.summary

    return { result, todoBackup, recentFilePaths }
  }

module.exports = { _notifyProgress, _persistLastStep, _cleanMessage, _extractRecentFilePaths, _autoCompactIfNeeded }