/**
 * UnifiedStrategy - 单 agent 主循环
 *
 * 从 UnifiedOrchestrator.run() 迁入。
 * 委托给：
 * - systemPromptBuilder.buildSystemPrompt()
 * - mdInstructionBuilder.buildMDInstruction()
 *
 * 错误处理（P1-1）：用 3 个独立计数器区分错误源
 * - llmParse: LLM 返回解析失败（JSON 错误、tool_call 格式错等）
 * - llmNetwork: LLM 网络错误（429、超时、连接失败）
 * - skillExec: skill 执行失败
 * 升级判断：任一计数器 >= threshold → fatal
 *
 * 拆分说明（优化项 2，行为不变）：
 * - 工具执行方法集（_executeToolCalls/_executeSingleTool/熔断常量等）→ ./toolExecutor
 * - 辅助方法集（_notifyProgress/_autoCompactIfNeeded 等）→ ./strategyHelpers
 * 拆出的方法以 Object.assign 挂回原型，this 调用链与对外导出签名均不变。
 */

const path = require('path')
const os = require('os')
const { buildSystemPrompt } = require('../systemPromptBuilder')
const { trim } = require('../messageTrimmer')
const errorHandler = require('../../utils/errorHandler')
const { DEFAULT_AGENT_MAX_STEPS } = require('../../utils/agentConstants')
const { getInstance: getAgentMdService } = require('../agentMd')
const { classifyError } = require('../errorClassifier')
const { createAsyncLogWriter } = require('../../utils/asyncLogWriter')
const { tryWithFailover } = require('../../services/llmFailover')
const { estimateTextTokens } = require('../../../shared/utils/contextStats')
const DeepSeekService = require('../../services/DeepSeekService')
const MemoryTierService = require('../../services/MemoryTierService')
const ToolResultStore = require('../ToolResultStore')
const { ChatHistory } = require('../../db/database')
const { SOFT_WARN_THRESHOLD, HARD_FUSE_THRESHOLD, LLN_NETWORK_FUSE } = require('./toolExecutor')
const { _notifyProgress, _persistLastStep, _cleanMessage, _extractRecentFilePaths, _autoCompactIfNeeded } = require('./strategyHelpers')
const { _buildCachedToolMsg, _emitToolCompletion, _checkSteerInterrupt, _executeSingleTool, _executeToolCalls } = require('./toolExecutor')
// 方案一 catalog 技能路由：会话级已加载技能登记表（单例，与 use-skill/toolExecutor 共享）
const sessionLoadedSkills = require('../sessionLoadedSkills')

// 诊断日志：写到 agent-debug.log（与 agentHandler._log 同一文件）
const _diagLogFile = path.join(os.homedir(), '.concrete-mixdesign', 'agent-debug.log')
// 异步批量写入（300ms 合并落盘，退出前由 main.js before-quit 调 flushAll 兜底）
const _diagLogWriter = createAsyncLogWriter(_diagLogFile)
function _diagLog(msg) {
  _diagLogWriter.append(`[${new Date().toISOString()}] [UnifiedStrategy] ${msg}\n`)
  console.log(`[UnifiedStrategy] ${msg}`)
}

const DEFAULT_TOKEN_BUDGET = 150000

class UnifiedStrategy {
  constructor({ deepseekService, skillRegistry, skillExecutor, agentMemoryService, systemService, orchestrator, softSkillInjector }) {
    this.deepseekService = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor
    this.agentMemoryService = agentMemoryService
    this.systemService = systemService || null
    this.agentMdService = getAgentMdService()
    // v9.1.0: 保存 Orchestrator 引用，让 ask_user 等跨进程协同 skill 能通过 context 拿到 orchestrator
    this.orchestrator = orchestrator || null
    // Task 7: soft skill injector（外部已构造，可复用）
    this.softSkillInjector = softSkillInjector || null
    // webContents 在 execute() 时才知道，先置空
    this.webContents = null
    // Task 2: 工具结果缓存（微压缩）
    this.toolResultStore = new ToolResultStore()
    // Task 4: 自动压缩计数器（Layer 2 Auto-Compaction）
    this._lastCompactionTime = 0
    this._compactionFailureCount = 0
    this._compactionSkipCount = 0
    this._previousSummary = ''
  }

  async execute(input) {
    const { sessionId, message, webContents, signal, getState, mode, attachments } = input
    this.sessionId = sessionId
    this.webContents = webContents || null

    // P0 断点续跑（B-1 命门）：mode='resume' 分支
    // - 跳过 soft skill 激活、附件处理
    // - 恢复 todo 快照（restoreCheckpoint）
    // - 构造续跑指令消息并落库，作为 enhancedMessage 驱动首轮 LLM 调用
    // - LLM 既看到完整历史（buildHistoryMessages 重建），又收到明确续跑指令
    const isResume = mode === 'resume'
    if (isResume) {
      _diagLog(`🔄 断点续跑启动：sessionId=${sessionId}，恢复 todo 快照 + 追加续跑指令`)
      try {
        await this.agentMemoryService.restoreCheckpoint(sessionId)
      } catch (e) {
        _diagLog(`⚠️ restoreCheckpoint 失败（继续续跑）: ${e.message}`)
      }
    }

    // Task 7: Soft skill 触发判断（在任何 LLM 调用前；resume 时跳过——无新用户消息不应激活 soft skill）
    if (this.softSkillInjector && !isResume) {
      this.softSkillInjector.tryActivate(sessionId, message || '')
    }

    // v9.1.0：多模态图片处理分流
    // - visionCapable=true：直接把图片作为 content 数组发给主 LLM，跳过 analyze_concrete_image
    // - visionCapable=false：走现有 analyze_concrete_image 技能（独立 VisionService）
    let enhancedMessage = message
    let multimodalImages = null

    // resume 分支：构造续跑指令消息并落库，作为 enhancedMessage 驱动首轮 LLM 调用
    if (isResume) {
      const resumeInstruction = '（续跑）请继续完成之前的任务，从上次中断处接着做'
      enhancedMessage = resumeInstruction
      try {
        await this.agentMemoryService.saveMessage({
          sessionId,
          role: 'user',
          content: resumeInstruction,
          metadata: { resume: true }
        })
      } catch (e) {
        _diagLog(`⚠️ 续跑指令落库失败（继续）: ${e.message}`)
      }
    } else if (Array.isArray(attachments) && attachments.length > 0) {
      // 检查当前 LLM 配置是否支持多模态
      let visionCapable = false
      try {
        const llmConfig = await this.systemService?.getActiveLlmConfig?.()
        visionCapable = llmConfig?.visionCapable === true
      } catch (e) {
        // 读取配置失败，降级走视觉分析技能
      }

      const imageAttachments = attachments.filter(att => att && att.type === 'image' && att.base64)

      if (visionCapable && imageAttachments.length > 0) {
        // 多模态路径：收集图片，直接发给主 LLM
        _diagLog(`🖼️ 多模态路径：visionCapable=true，${imageAttachments.length} 张图片将直接发给主 LLM`)
        multimodalImages = imageAttachments.map(att => ({
          base64: att.base64,
          mimeType: att.mimeType || 'image/jpeg'
        }))
        // enhancedMessage 保持原样（不拼接图片描述），图片通过 content 数组发送
      } else {
        // 非多模态路径：走现有 analyze_concrete_image 技能（独立 VisionService）
        _diagLog(`🔍 非多模态路径：visionCapable=${visionCapable}，走 analyze_concrete_image 技能，attachments.length=${attachments.length}`)
        attachments.forEach((att, i) => {
          _diagLog(`  att[${i}]: type=${att?.type} originalName=${att?.originalName} sizeKB=${att?.sizeKB} base64Len=${att?.base64?.length || 0} hasBase64=${!!att?.base64}`)
        })
        const imageDescs = []
        for (const att of attachments) {
          if (!att || att.type !== 'image' || !att.base64) {
            _diagLog(`⏭️ 跳过附件: type=${att?.type} hasBase64=${!!att?.base64} reason=${!att ? 'null' : att.type !== 'image' ? '非image' : 'base64为空'}`)
            continue
          }
          try {
            _diagLog(`🖼️ 调用 analyze_concrete_image，base64Len=${att.base64.length} question=${(message || '请描述这张图片').slice(0, 50)}`)
            const result = await this.skillExecutor.execute('analyze_concrete_image', {
              imageBase64: att.base64,
              question: message || '请描述这张图片',
              context: { source: 'chat_attachment' }
            })
            _diagLog(`📋 analyze_concrete_image 结果: success=${result?.success} errorCode=${result?.errorCode || result?.code} imageType=${result?.imageType} descLen=${result?.description?.length || 0}`)
            if (result && result.success) {
              imageDescs.push({
                originalName: att.originalName || '图片',
                sizeKB: att.sizeKB,
                imageType: result.imageType || 'general',
                description: result.description || '',
                details: result.details || {}
              })
            } else {
              // 视觉模型未配置或调用失败：降级，把文件名告知 LLM
              imageDescs.push({
                originalName: att.originalName || '图片',
                sizeKB: att.sizeKB,
                description: '[图片识别失败，请用户检查视觉模型配置]',
                errorCode: result?.errorCode || result?.code
              })
            }
          } catch (err) {
            // 单张图片失败不阻塞其他图片
            _diagLog(`❌ 图片分析异常: ${err.message} stack=${err.stack?.slice(0, 200)}`)
            imageDescs.push({
              originalName: att.originalName || '图片',
              description: `[图片分析异常：${err.message}]`
            })
          }
        }
        _diagLog(`✅ 附件预处理完成: imageDescs.length=${imageDescs.length} enhancedMessage前200字符="${enhancedMessage.slice(0, 200)}"`)
        if (imageDescs.length > 0) {
          const imgSummary = imageDescs.map((d, i) =>
            `【图片${i + 1}：${d.originalName}（${d.sizeKB || '?'}KB）】\n类型：${d.imageType || '?'}\n描述：${d.description}${d.details && Object.keys(d.details).length ? '\n详情：' + JSON.stringify(d.details) : ''}`
          ).join('\n\n')
          enhancedMessage = (message ? message + '\n\n' : '') + `📎 老板上传了 ${imageDescs.length} 张图片：\n\n${imgSummary}`
          _diagLog(`📎 enhancedMessage 已拼接图片描述，总长度=${enhancedMessage.length}`)
        }
      }
    }

    const failureCounters = {
      llmParse: 0,
      llmNetwork: 0,
      skillExec: 0
    }
    // v8.2.5: 软提醒标志 — 连续失败 3 次后向 LLM 注入"换路"提示
    // 计数器归零时同步重置（见 execute 主体两处）
    const softWarnSent = { llmParse: false, skillExec: false }
    // 旧变量名保留：原 threshold 现指向模块级 HARD_FUSE_THRESHOLD（兼容旧断言）
    const threshold = HARD_FUSE_THRESHOLD

    // 1. 构造 messages
    // v2 改造（Task 8）：单字段 userRulesMarkdown 整段注入
    // - 不再调 agentMemoryService.buildMemoryContext（已重命名为 buildAgentMdBlock，且 v2 不再拼 history）
    // - agent.md 整段从 agentMdService.getFormattedRules() 拿，走 userRulesMarkdown 单一字段
    const historyMessages = await this.agentMemoryService.buildHistoryMessages(sessionId)

    // ===== 方案一 catalog 技能路由开关 =====
    // 读 LLM 设置字段 skillRoutingMode：'full'=旧版全量行为；缺失/其他值一律 'catalog'（默认）。
    // 仿 maxSteps 读取模式（读不到配置不阻塞，走默认值）。须在 buildSystemPrompt 之前确定，
    // 因为 renderMode 与 tools 集合都依赖它。
    let routingMode = 'catalog'
    try {
      const routeCfg = await this.deepseekService._getConfig()
      if (routeCfg && routeCfg.skillRoutingMode === 'full') routingMode = 'full'
    } catch (_) { /* 读不到配置按 catalog */ }
    this.routingMode = routingMode

    const skillNames = this.skillRegistry.getToolSchemas().map(s => s.function.name)
    const skillInfos = skillNames.map(name => {
      const meta = this.skillRegistry.getSkillMeta(name)
      if (!meta) return null
      // 方案一 catalog 路由：附 resident 标记供 systemPromptBuilder 区分「常驻段/目录段」
      const resident = typeof this.skillRegistry.isResident === 'function'
        ? this.skillRegistry.isResident(name)
        : false
      return { ...meta, resident }
    }).filter(Boolean)

    const userRulesMarkdown = this.agentMdService.getFormattedRules()

    // P0：每 20 轮自动触发归档摘要（异步，不阻塞主流程）
    try {
      const msgCount = await ChatHistory.count({ where: { sessionId } })
      if (msgCount >= 20) {
        MemoryTierService.summarizeNextBatch(sessionId, {
          batchSize: 20,
          minMessages: 20
        }).catch(err => console.warn('[UnifiedStrategy] 归档摘要失败:', err.message))
      }
    } catch (_) {}

    // P0：L3 归档记忆召回（用当前用户消息关键词）
    let l3Summary = null
    try {
      const recalled = await MemoryTierService.recall(message || '', { topK: 3 })
      if (recalled.length > 0) {
        l3Summary = { currentSession: (message || '').slice(0, 100), recalled }
      }
    } catch (_) {}

    // P1-1：跨会话摘要注入（从 SessionSummary 取最近 3 个不同会话）
    let crossSessionBlock = ''
    try {
      const recentSessions = await MemoryTierService._getRecentSessions(3)
      if (recentSessions.length > 0) {
        const lines = recentSessions.map(s => `- 【${s.sessionId.slice(0, 8)}】${s.summary}`)
        crossSessionBlock = `\n# 老板最近会话\n${lines.join('\n')}\n`
      }
    } catch (_) {}

    // Task 7: 拼 soft skill 激活段（resume 时跳过——无新用户消息激活的 soft skill 不应注入）
    const softSkillSection = (this.softSkillInjector && !isResume)
      ? await this.softSkillInjector.buildInjectionSection(sessionId)
      : ''

    const systemPrompt = buildSystemPrompt({
      memoryContext: '',
      userRulesMarkdown,
      skillNames,
      skillInfos,
      renderMode: routingMode === 'full' ? 'full' : 'catalog',
      l3Summary,
      crossSessionBlock,
      softSkillSection  // Task 7: soft skill 注入段
    })

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      // 多模态：如果有 multimodalImages，用 content 数组（text + image_url）
      multimodalImages && multimodalImages.length > 0
        ? { role: 'user', content: [
            ...(enhancedMessage ? [{ type: 'text', text: enhancedMessage }] : []),
            ...multimodalImages.map(img => ({ type: 'image_url', image_url: { url: img.base64 } }))
          ]}
        : { role: 'user', content: enhancedMessage }
    ]

    let tokenBudget = DEFAULT_TOKEN_BUDGET
    if (this.systemService && typeof this.systemService.getAgentConfig === 'function') {
      try {
        const cfg = await this.systemService.getAgentConfig()
        if (cfg && Number.isFinite(cfg.messageTrimmerTokenBudget)) {
          tokenBudget = cfg.messageTrimmerTokenBudget
        }
      } catch (e) {
        errorHandler.warn('truncate_cfg_read', { msg: e?.message })
      }
    }
    // Layer 2: 自动压缩检查 — 在 trim 之前检查原始消息水位
    // 先检查原始 messages（含完整的 system prompt + history），超 78% 才压缩
    let messagesForLLM = messages
    const autoCompactResult = await this._autoCompactIfNeeded(messages, sessionId, tokenBudget)
    if (autoCompactResult && autoCompactResult.result) {
      const { result, todoBackup, recentFilePaths } = autoCompactResult

      // 构造压缩后的消息数组
      const systemMsg = messages.find(m => m.role === 'system')
      const compactedMessages = [
        { role: 'system', content: systemMsg ? systemMsg.content : '' },
        {
          role: 'assistant',
          content: `【对话摘要】${result.summary}`,
          _compacted: true
        },
        ...(result.recentMessages || [])
      ]

      // 注入续传指令（含 todo 恢复信息）
      if (todoBackup && Array.isArray(todoBackup.todos)) {
        const pendingTodos = todoBackup.todos.filter(t => t.status !== 'completed')
        if (pendingTodos.length > 0) {
          const todoText = pendingTodos.map(t =>
            `- [${t.status}] ${t.content}`
          ).join('\n')
          compactedMessages.push({
            role: 'user',
            content: `【续传指令】你刚才在处理的任务已完成部分，仍有以下待办事项：\n${todoText}\n请继续处理。不要重复已完成的步骤。`
          })
        }
      }

      messagesForLLM = compactedMessages

      // 添加文件上下文（压缩后告知 AI 之前处理过哪些文件）
      if (recentFilePaths && recentFilePaths.length > 0) {
        const fileList = recentFilePaths.map(f =>
          `  - [${f.skill}] ${f.path}`
        ).join('\n')
        compactedMessages.push({
          role: 'user',
          content: `【文件上下文】压缩前你正在处理以下文件，如需继续请重新读取：\n${fileList}`
        })
      }

      // 通知前端
      this._notifyProgress(webContents, {
        type: 'context_compacted',
        summary: result.summary,
        realTokens: result.realTokens
      })
    }

    // trim 在 auto-compact 之后，压缩后的消息显著减小，trim 基本不触发
    const trimmedMessages = trim(messagesForLLM, { tokenBudget })
// 注意：用户消息已由前端 agentActions.js 保存，此处不再重复保存

    let finalResult = null
    // [DEBUG] 累积每轮 LLM 调用日志，熔断时附加到错误对象返回前端
    const debugLog = []

    // 2. 主循环（流式）

    // ===== 方案一 catalog 技能路由：tools 集合工厂 =====
    // - catalog（默认）：常驻集 ∪ use_skill ∪ 会话已加载技能；其余技能只以目录形式在 system prompt
    // - full：旧行为，全量 getToolSchemas()
    // - 注册表缺 getRoutingToolSchemas（旧式最小 mock）时降级 full，保证既有测试与调用方不受影响
    const canRoute = typeof this.skillRegistry.getRoutingToolSchemas === 'function'
    const getCurrentToolSchemas = () => {
      if (routingMode === 'full' || !canRoute) {
        return this.skillRegistry.getToolSchemas()
      }
      return this.skillRegistry.getRoutingToolSchemas(sessionLoadedSkills.get(sessionId))
    }
    let toolSchemas = getCurrentToolSchemas()

    // v0.9.x 输出优化：估算上下文构成（system/tools/messages），供前端细分面板展示
    // 用共享 estimateTextTokens（CJK 1 字≈1 token / 其他 4 字符≈1 token），
    // 与下方 model_info 兜底估算、前端圆环估算口径一致——
    // 旧 chars/4 对中文低估 3~4 倍；messages 用 trimmedMessages（实际发给 LLM 的）
    try {
      this._notifyProgress(webContents, {
        type: 'context_stats',
        breakdown: {
          system: estimateTextTokens(systemPrompt),
          tools: estimateTextTokens(JSON.stringify(toolSchemas || [])),
          messages: estimateTextTokens(JSON.stringify(trimmedMessages || []))
        }
      })
    } catch (_) { /* 统计失败不影响主流程 */ }

    // v11.7.5: 获取全部 LLM 配置，用于 failover 自动切换
    let allLlmConfigs = null
    if (this.systemService && typeof this.systemService.getLlmConfigs === 'function') {
      try {
        allLlmConfigs = await this.systemService.getLlmConfigs()
      } catch (e) { /* 获取失败则降级为仅当前 config */ }
    }

    // v1.2: 从配置读取最大循环步数
    // v1.2: 复用 DeepSeekService._getConfig()，避免重复实现"读 systemService + 兜底"逻辑
    let maxSteps = DEFAULT_AGENT_MAX_STEPS
    if (this.deepseekService && typeof this.deepseekService._getConfig === 'function') {
      try {
        const cfg = await this.deepseekService._getConfig()
        if (cfg && Number.isFinite(cfg.maxSteps)) {
          maxSteps = cfg.maxSteps
        }
      } catch (e) {
        errorHandler.warn('agentMaxSteps_read', { msg: e?.message })
      }
    }

    // 批 B Task 1.8（C-5）：followUp 续跑时重置 step 计数器，不累加到 maxSteps 上限
    // 用 _stepReset 标志而非 while 改造——保留 for 的 continue 语义（continue 自动 step++），
    // 避免 while+手动 step++ 在多个 continue 路径漏递增导致死循环
    let _stepReset = false
    for (let step = 0; step < maxSteps; step++) {  // v1.2: 改为 maxSteps
      if (_stepReset) { step = 0; _stepReset = false }
      if (webContents?.isDestroyed?.()) {
        this._notifyProgress(webContents, { type: 'error', error: 'wc_destroyed', mode })
        return { success: false, error: 'wc_destroyed' }
      }
      if (signal?.aborted) {
        this._notifyProgress(webContents, { type: 'error', error: 'aborted', mode })
        return { success: false, error: 'aborted' }
      }
      // ② paused 循环（含 interrupt 处理，问题 C：paused 优先于主循环顶部 interrupt 检查）
      while (getState && getState() === 'paused') {
        await new Promise(r => setTimeout(r, 100))
        if (signal?.aborted) {
          this._notifyProgress(webContents, { type: 'error', error: 'aborted', mode })
          return { success: false, error: 'aborted' }
        }
        // v3.0 问题 C：paused 状态下 interruptRequested → resume + 注入插话 + 继续
        if (this.orchestrator?.isInterrupted?.()) {
          const _steer = this.orchestrator?.drainSteering?.() || []
          if (_steer.length > 0) {
            const _c = _steer.join('\n')
            trimmedMessages.push({ role: 'user', content: _c })
            try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { steer: true, immediate: true } }) } catch (_) {}
            this._notifyProgress(webContents, { type: 'steer_injected', content: _c, mode, source: 'immediate_paused' })
            this.orchestrator?.clearInterrupt?.()
            this.orchestrator?.resume?.()
            break  // 跳出 paused 循环，继续主循环
          }
          this.orchestrator?.clearInterrupt?.()
        }
      }
      // ③ 主循环顶部的 interrupt 检查（非 paused 状态，问题 C：移到 paused 之后）
      // 中断 ≠ 终止：不 return，只注入插话后继续（下面会走 LLM 调用）
      if (this.orchestrator?.isInterrupted?.()) {
        const _steer = this.orchestrator?.drainSteering?.() || []
        if (_steer.length > 0) {
          const _c = _steer.join('\n')
          trimmedMessages.push({ role: 'user', content: _c })
          try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { steer: true, immediate: true } }) } catch (_) {}
          this._notifyProgress(webContents, { type: 'steer_injected', content: _c, mode, source: 'immediate' })
          this.orchestrator?.clearInterrupt?.()
        } else {
          // 防御性：interruptRequested 只由 steerImmediate 设置，理论上必然伴随插话
          this.orchestrator?.clearInterrupt?.()
        }
      }

      // ④ 每轮 LLM 调用前 drain steering，有则注入 user 消息（插话尽快被 LLM 看到）
      const _steeringMsgs = this.orchestrator?.drainSteering ? this.orchestrator.drainSteering() : []
      if (_steeringMsgs.length > 0) {
        const _steerContent = _steeringMsgs.join('\n')
        trimmedMessages.push({ role: 'user', content: _steerContent })
        try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _steerContent, metadata: { steer: true } }) } catch (_) {}
        this._notifyProgress(webContents, { type: 'steer_injected', content: _steerContent, mode })
      }

      // 通知前端：新一轮思考开始
      const roundIndex = step
      this._notifyProgress(webContents, { type: 'reasoning_start', roundIndex, mode, status: 'running' })

      // 方案一 catalog 路由：每轮重算 tools——上一轮 use_skill / 拦截自动展开新登记的技能本轮进入集合
      toolSchemas = getCurrentToolSchemas()

      let response
      try {
        // ===== 流式调用 LLM（v11.7.5: 接入 failover 自动切换） =====
        // 用全部配置列表做 failover；如果取不到则降级为仅当前 service 的 config
        const failoverConfigs = (allLlmConfigs && allLlmConfigs.length > 0)
          ? allLlmConfigs
          : [await this.deepseekService._getConfig().catch(() => ({}))]

        // v11.7.9: 激活配置优先 — 获取当前激活的配置 ID 传入 failover
        let activeId = null
        if (this.systemService && typeof this.systemService.getActiveLlmConfig === 'function') {
          try {
            const ac = await this.systemService.getActiveLlmConfig()
            activeId = ac?.id || null
          } catch (_) {}
        }

        let switchedFrom = null
        // Task 10: 每轮独立 AbortController — Alt+Enter 立即插话可 abort 本轮 LLM 流式调用
        // 同步注入 orchestrator：controlMixin.requestInterrupt() 在 Orchestrator 实例上 abort 该 controller，
        // 否则真实链路 Alt+Enter abort 不到（orchestrator._currentTurnAbort 为 undefined），立即插话退化成排队插话
        this._currentTurnAbort = new AbortController()
        if (this.orchestrator) this.orchestrator._currentTurnAbort = this._currentTurnAbort
        const { result, usedConfig } = await tryWithFailover(
          failoverConfigs,
          async (config) => {
            const service = new DeepSeekService(config, this.systemService)
            return service.chatWithToolsStream(
              trimmedMessages,
              toolSchemas,
              (event) => {
                // 实时转发流式事件给前端
                if (event.type === 'reasoning_delta') {
                  this._notifyProgress(webContents, {
                    type: 'reasoning_delta',
                    content: event.content,
                    roundIndex,
                    mode,
                    status: 'running'
                  })
                } else if (event.type === 'text_delta') {
                  this._notifyProgress(webContents, {
                    type: 'text_delta',
                    content: event.content,
                    mode,
                    status: 'running'
                  })
                }
              },
              this._currentTurnAbort.signal
            )
          },
          (fromName, toName, reason) => {
            switchedFrom = fromName
            this._notifyProgress(webContents, {
              type: 'model_switched',
              from: fromName,
              to: toName,
              reason,
            })
          },
          {
            activeId,  // v11.7.9: 激活模型优先
            // v3.1 要点 2：中断错误（AbortError / 用户插话标志）直接穿透，不切换配置
            shouldStopOnError: (err) => err?.name === 'AbortError'
              || err?.code === 'ERR_CANCELED'
              || this.orchestrator?.isInterrupted?.(),
            // v0.9.x：切换前告知——把失败配置的错误用人话抛给前端时间线留痕
            onAttemptFail: ({ failedName, nextName, error }) => {
              let reason = { code: 'unknown', title: '调用失败', hint: '' }
              try {
                const c = classifyError(error, { callSite: 'llmFailover.onAttemptFail' })
                if (c && c.code) {
                  reason = { code: c.code, title: c.title, hint: c.hint }
                }
              } catch (_) {}
              this._notifyProgress(webContents, {
                type: 'model_switching',
                from: failedName,
                to: nextName,
                reason,
              })
            }
          }
        )
        response = result

        // v11.7.7: 通知前端当前路由到的 LLM 模型，让用户可感知路由状态
        // v0.9.x 输出优化：附加本轮 token 用量（DeepSeek 流式最后一个 chunk 的 usage）与真实上下文上限，
        // 供统计行与上下文圆环（真实 prompt_tokens / 真实 contextLimit）使用
        if (usedConfig) {
          // v0.9.x：上下文上限取 LLM 设置里的 contextLimit（用户配置）
          // 圆环修复：优先读 failover 实际使用的 usedConfig.contextLimit——
          // failover 换模型后分母必须跟着换（各模型上限不同，如 128K/1M），
          // 读不到再降级 _getConfig()；配置存储可能是字符串（如 "1023999"），必须 Number()
          let llmContextLimit = 800000
          try {
            const cl = Number(usedConfig && usedConfig.contextLimit)
            if (Number.isFinite(cl) && cl > 0) {
              llmContextLimit = cl
            } else {
              const llmCfg = await this.deepseekService._getConfig()
              const fb = Number(llmCfg && llmCfg.contextLimit)
              if (Number.isFinite(fb) && fb > 0) llmContextLimit = fb
            }
          } catch (_) {}
          // 防御：部分代理网关（如 opencode.ai 中转）不回传 usage → 用共享公式估算兜底，
          // 保证上下文圆环/统计行始终有值（真实 usage 优先）
          let llmUsage = response?.usage || null
          if (!llmUsage) {
            try {
              const promptTokens = estimateTextTokens(systemPrompt) + estimateTextTokens(JSON.stringify(toolSchemas || [])) + estimateTextTokens(JSON.stringify(trimmedMessages || []))
              const completionTokens = estimateTextTokens(response?.content || '')
              llmUsage = {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
              }
            } catch (_) {}
          }
          this._notifyProgress(webContents, {
            type: 'model_info',
            model: usedConfig.model || '',
            provider: usedConfig.provider || '',
            name: usedConfig.name || '',
            usage: llmUsage,
            contextLimit: llmContextLimit,
          })
        }

        // [DEBUG] 记录 LLM 成功返回
        const successLog = {
          round: roundIndex, status: 'ok',
          switchedFrom: switchedFrom || undefined,
          content: response.content?.slice(0, 500),
          tool_calls: response.tool_calls?.map(tc => ({ id: tc.id, name: tc.function?.name, args: tc.function?.arguments?.slice(0, 300) })),
          reasoning_content: response.reasoning_content?.slice(0, 300),
        }
        debugLog.push(successLog)
        this._notifyProgress(webContents, { type: 'debug_log', tag: '✅ LLM OK', data: successLog, roundIndex, mode })

      } catch (err) {
        // v3.0: 中断不报错，走 drain steering 流程（Alt+Enter 立即插话：LLM 流式被 abort）
        if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED' || this.orchestrator?.isInterrupted?.()) {
          const _steer = this.orchestrator?.drainSteering?.() || []
          if (_steer.length > 0) {
            const _c = _steer.join('\n')
            trimmedMessages.push({ role: 'user', content: _c })
            try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { steer: true, immediate: true } }) } catch (_) {}
            this._notifyProgress(webContents, { type: 'steer_injected', content: _c, mode, source: 'immediate' })
            this.orchestrator?.clearInterrupt?.()
            continue
          }
          // 防御性：无插话的中断理论上不存在（interruptRequested 只由 steerImmediate 设置）
          this.orchestrator?.clearInterrupt?.()
          continue
        }
        // [DEBUG] 记录 LLM 调用失败 → 推送前端 + 累积到 debugLog
        // ⚠️ 只提取安全的原始值，不引用 err 对象（含循环引用的 TLSSocket）
        const failLog = {
          round: roundIndex, status: 'error',
          message: String(err.message || ''),
          code: String(err.code || ''),
          httpStatus: err.details?.httpStatus || err.response?.status || null,
          rawMessage: String(err.details?.rawMessage || ''),
        }
        debugLog.push(failLog)
        this._notifyProgress(webContents, { type: 'debug_log', tag: '❌ LLM 失败', data: failLog, roundIndex, mode })
        // 2026-08-24 落盘：失败详情（错误码/HTTP状态/耗时）此前只推前端轨迹，重启即失——
        // 落 agent-debug.log 供事后定位限流/超时/参数错（failLog 无用户内容，无隐私面）
        console.error('[LLM失败]', JSON.stringify({ ...failLog, sessionId, round: roundIndex }))

        this._notifyProgress(webContents, {
          type: 'reasoning_error',
          error: err.message,
          roundIndex,
          mode,
          status: 'running'
        })

        // v8.2.1: _buildClassifiedError 将异常包装为 createError 格式（含 .code / .details.httpStatus）
        // 按语义错误码区分网络错误 vs 解析错误，而非读原始 axios 属性
        const isNetworkError = (
          err.code === 'E-LLM-429' ||
          err.code === 'E-NET-408' ||
          err.code === 'E-NET-500' ||
          err.details?.httpStatus === 429 ||
          // v8.2.5: 补充原始 axios 错误码（DeepSeekService 未分类时直接透传）
          err.code === 'ECONNABORTED' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ENOTFOUND' ||
          err.code === 'ECONNREFUSED'
        )
        if (isNetworkError) {
          failureCounters.llmNetwork++
        } else {
          failureCounters.llmParse++

          // v8.2.5: 软提醒 — 连续失败 3 次后向 LLM 注入"换路"提示
          // 仅触发 1 次（用 softWarnSent 标志防重复），成功时计数器清零 → 标志重置
          if (failureCounters.llmParse === SOFT_WARN_THRESHOLD && !softWarnSent.llmParse) {
            const warnMsg = '⚠️ 你已在这条路径上连续失败 3 次（LLM 解析错误）。请停下分析：失败原因是什么？换一种工具 / 换一套参数 / 换条路径，而不是重试同样的方法。'
            trimmedMessages.push({ role: 'user', content: warnMsg })
            softWarnSent.llmParse = true
          }
        }

        if (err.code === 'E-LLM-429' && failureCounters.llmNetwork < threshold) {
          // 2026-08-24 改进：限流退避加长——首次 15s、指数递增、上限 60s（限流窗口通常 ≥60s，原 5s 起常撞墙）
          const backoffMs = Math.min(15000 * Math.pow(2, failureCounters.llmNetwork - 1), 60000)
          console.warn(`[LLM] 429 限流，${Math.round(backoffMs / 1000)}s 后自动重试（第 ${failureCounters.llmNetwork}/${threshold} 次）`)
          await new Promise(r => setTimeout(r, backoffMs))
          continue
        }

        if (failureCounters.llmParse >= HARD_FUSE_THRESHOLD || failureCounters.llmNetwork >= LLN_NETWORK_FUSE) {
          // [DEBUG] 熔断 → 推送完整 debugLog 给前端
          this._notifyProgress(webContents, {
            type: 'debug_log', tag: '🔴 熔断',
            data: { counters: { ...failureCounters }, totalRounds: step + 1, debugLog },
            roundIndex, mode,
          })
          errorHandler.fatal('orchestrator', { counters: failureCounters })
          const classifiedError = classifyError(new Error('max_failures_exceeded: LLM parse/network failures exceeded threshold'), {
            callSite: 'UnifiedStrategy.llmLoop',
            sessionId,
          })
          // 2026-08-24 改进：按失败类型区分提示——网络类（限流/超时）是临时性的，引导等待而非改任务描述
          if (failureCounters.llmNetwork >= LLN_NETWORK_FUSE) {
            classifiedError.title = 'AI 服务暂时限流或网络波动'
            classifiedError.hint = '通常是 API 速率限制，一般稍等 1-2 分钟自动恢复；稍后点"继续"即可，无需修改任务描述'
            classifiedError.recovery = 'wait_retry'
          }
          // 把 debugLog 附加到错误对象，前端可直接读取
          if (classifiedError.details) classifiedError.details.debugLog = debugLog
          this._notifyProgress(webContents, { type: 'error', error: classifiedError, mode })
          return { success: false, error: classifiedError }
        }
        continue
      }

      failureCounters.llmParse = 0
      failureCounters.llmNetwork = 0
      // v8.2.5: LLM 正常返回 → 计数器清零 → 同步重置软提醒标志
      softWarnSent.llmParse = false

      // 通知前端：本轮思考完成
      this._notifyProgress(webContents, { type: 'reasoning_done', roundIndex, mode, status: 'running' })

      // 3. LLM 返回纯文本（无工具调用）→ 任务完成
      if (response.content && (!response.tool_calls || response.tool_calls.length === 0)) {
        // 保存最终 assistant 回复到对话历史
        try {
          await this.agentMemoryService.saveMessage({
            sessionId, role: 'assistant', content: response.content,
            metadata: response.reasoning_content ? { reasoning_content: response.reasoning_content } : null
          })
        } catch (_) {}

        // 批 B Task 1.8 ②③：完成前先 drain steering/followUp，有内容则不结束继续下一轮（steering 优先）
        const _steerTail = this.orchestrator?.drainSteering ? this.orchestrator.drainSteering() : []
        if (_steerTail.length > 0) {
          const _c = _steerTail.join('\n')
          trimmedMessages.push({ role: 'user', content: _c })
          try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { steer: true } }) } catch (_) {}
          this._notifyProgress(webContents, { type: 'steer_injected', content: _c, mode })
          this.orchestrator?.clearInterrupt?.()  // v3.0 问题 B：continue 前清中断标志，防下一轮误退出
          continue  // 不 return，下一轮 LLM 看到插话
        }
        const _followUpMsgs = this.orchestrator?.drainFollowUp ? this.orchestrator.drainFollowUp() : []
        if (_followUpMsgs.length > 0) {
          const _c = _followUpMsgs.join('\n')
          trimmedMessages.push({ role: 'user', content: _c })
          try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { followUp: true } }) } catch (_) {}
          this._notifyProgress(webContents, { type: 'followup_injected', content: _c, mode })
          _stepReset = true  // C-5: followUp 续跑重置 step 计数器，不累加到 maxSteps
          continue
        }

        finalResult = { reply: response.content, mode }
        this._notifyProgress(webContents, { type: 'done', result: finalResult, mode })
        return { success: true, content: response.content }
      }

      // 4. LLM 要调用工具
      if (response.tool_calls && response.tool_calls.length > 0) {
        // assistant 消息只推一次（包含所有 tool_calls）
        const assistantMsg = this._cleanMessage(response)
        trimmedMessages.push(assistantMsg)

        // 保存 assistant 消息到对话历史
        try {
          await this.agentMemoryService.saveMessage({
            sessionId, role: 'assistant', content: response.content || null,
            toolCalls: response.tool_calls,
            metadata: response.reasoning_content ? { reasoning_content: response.reasoning_content } : null
          })
        } catch (_) {}

        // Task 2.3: 读写分组并发执行工具（READ 并发 / WRITE 串行），
        // 事件与结果按原始 tool_call_id 顺序合并；插话/中断在批次边界与每个写工具后检查
        // 返回非 null = 硬熔断（fatal）→ 直接终止 execute；否则继续下一轮 LLM
        const toolExit = await this._executeToolCalls(response, {
          trimmedMessages,
          failureCounters,
          softWarnSent,
          mode,
          roundIndex
        })
        if (toolExit) return toolExit

        // Task 2: 最近 3 次工具结果还原（防上下文摘要化关键信息）
        const recentKeys = this.toolResultStore.getRecentKeys(sessionId, 3)
        for (const key of recentKeys) {
          const toolMsg = trimmedMessages.find(m => m.role === 'tool' && m.tool_call_id === key.toolCallId)
          if (toolMsg) {
            const content = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content
            if (content && content._cached) {
              const full = this.toolResultStore.get(key.toolCallId)
              if (full) {
                toolMsg.content = JSON.stringify(full)
              }
            }
          }
        }

        // 所有工具执行完毕，继续下一轮 LLM 调用
        // P0 断点续跑：每步末尾异步写 last_step（不 await，崩溃滞后 1 步可接受）
        this._persistLastStep(sessionId, step + 1)
        continue
      }

      // 5. LLM 既没有内容也没有工具调用
      return { success: true, content: response.content || '' }
    }

    const classifiedError = classifyError(new Error('max_steps_exceeded'), {
      callSite: 'UnifiedStrategy.maxStepsExceeded',
      sessionId,
    })
    this._notifyProgress(webContents, { type: 'error', error: classifiedError, mode })
    return { success: false, error: classifiedError }
  }
}

// 挂载从独立模块拆出的原型方法（优化项 2，行为不变）
Object.assign(UnifiedStrategy.prototype, {
  _notifyProgress,
  _persistLastStep,
  _cleanMessage,
  _extractRecentFilePaths,
  _autoCompactIfNeeded,
  _buildCachedToolMsg,
  _emitToolCompletion,
  _checkSteerInterrupt,
  _executeSingleTool,
  _executeToolCalls
})

module.exports = UnifiedStrategy