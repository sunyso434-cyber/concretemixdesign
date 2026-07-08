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
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { buildSystemPrompt } = require('../systemPromptBuilder')
const { buildMDInstruction } = require('../mdInstructionBuilder')
const { trim } = require('../messageTrimmer')
const errorHandler = require('../../utils/errorHandler')
const { DEFAULT_AGENT_MAX_STEPS } = require('../../utils/agentConstants')
const { getInstance: getAgentMdService } = require('../agentMd')
const { classifyError } = require('../errorClassifier')
const { rotateIfNeeded } = require('../../utils/logRotator')
const MemoryTierService = require('../../services/MemoryTierService')
const { ChatHistory } = require('../../db/database')

// 诊断日志：写到 agent-debug.log（与 agentHandler._log 同一文件）
const _diagLogFile = path.join(os.homedir(), '.concrete-mixdesign', 'agent-debug.log')
function _diagLog(msg) {
  const line = `[${new Date().toISOString()}] [UnifiedStrategy] ${msg}\n`
  try {
    rotateIfNeeded(_diagLogFile, { maxSize: 5 * 1024 * 1024, maxFiles: 5 })
    fs.appendFileSync(_diagLogFile, line)
  } catch (_) {}
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
  }

  /**
   * 向渲染进程推送进度事件
   * 始终携带 sessionId，让前端能按会话路由，避免多会话并行时串流到当前焦点会话
   */
  _notifyProgress(webContents, data) {
    if (webContents && !webContents.isDestroyed?.()) {
      try {
        webContents.send('agent:progress', { ...data, sessionId: this.sessionId })
      } catch (_) {}
    }
  }

  /**
   * 清理消息对象
   * ⚠️ DeepSeek thinking 模式硬性规定：
   * reasoning_content 只能出现在最后一条 assistant 消息中
   * 如果消息有 tool_calls（说明不是最后一条），必须剥离 reasoning_content，否则 API 400
   */
  _cleanMessage(msg) {
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

  async execute(input) {
    const { sessionId, message, webContents, signal, getState, mode, attachments } = input
    this.sessionId = sessionId
    this.webContents = webContents || null

    // Task 7: Soft skill 触发判断（在任何 LLM 调用前）
    if (this.softSkillInjector) {
      this.softSkillInjector.tryActivate(sessionId, message || '')
    }

    // v9.1.0：多模态图片处理分流
    // - visionCapable=true：直接把图片作为 content 数组发给主 LLM，跳过 analyze_concrete_image
    // - visionCapable=false：走现有 analyze_concrete_image 技能（独立 VisionService）
    let enhancedMessage = message
    let multimodalImages = null

    if (Array.isArray(attachments) && attachments.length > 0) {
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
    const SOFT_WARN_THRESHOLD = 3
    // v8.2.5: 硬熔断阈值 5 → 6（llmParse / skillExec 路径），给 LLM 看到软提醒后多 1 次纠错机会
    // v8.2.3: 失败阈值 2 → 5，给 LLM 更多自适应重试机会（换路径/换工具），避免触发误熔断
    const HARD_FUSE_THRESHOLD = 6
    // v8.2.5: 网络错误熔断保持 5（不在本次软提醒覆盖范围）
    const LLN_NETWORK_FUSE = 5
    // 旧变量名保留：原 threshold 现指向 HARD_FUSE_THRESHOLD（兼容旧断言）
    const threshold = HARD_FUSE_THRESHOLD

    // 1. 构造 messages
    // v2 改造（Task 8）：单字段 userRulesMarkdown 整段注入
    // - 不再调 agentMemoryService.buildMemoryContext（已重命名为 buildAgentMdBlock，且 v2 不再拼 history）
    // - agent.md 整段从 agentMdService.getFormattedRules() 拿，走 userRulesMarkdown 单一字段
    const historyMessages = await this.agentMemoryService.buildHistoryMessages(sessionId)
    const skillNames = this.skillRegistry.getToolSchemas().map(s => s.function.name)
    const skillInfos = skillNames.map(name => this.skillRegistry.getSkillMeta(name)).filter(Boolean)

    const userRulesMarkdown = this.agentMdService.getFormattedRules()

    // P0：每 20 轮自动触发归档摘要（异步，不阻塞主流程）
    try {
      const msgCount = await ChatHistory.count({ where: { sessionId } })
      if (msgCount >= 20 && msgCount % 20 === 0) {
        MemoryTierService.summarizeOldMessages(sessionId, {
          rangeStart: Math.max(1, msgCount - 19),
          rangeEnd: msgCount
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

    // Task 7: 拼 soft skill 激活段
    const softSkillSection = this.softSkillInjector
      ? await this.softSkillInjector.buildInjectionSection(sessionId)
      : ''

    const systemPrompt = buildSystemPrompt({
      memoryContext: '',
      userRulesMarkdown,
      skillNames,
      skillInfos,
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
    const trimmedMessages = trim(messages, { tokenBudget })

    // 注意：用户消息已由前端 agentActions.js 保存，此处不再重复保存

    let finalResult = null
    // [DEBUG] 累积每轮 LLM 调用日志，熔断时附加到错误对象返回前端
    const debugLog = []

    // 2. 主循环（流式）
    const toolSchemas = this.skillRegistry.getToolSchemas()

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

    for (let step = 0; step < maxSteps; step++) {  // v1.2: 改为 maxSteps
      if (webContents?.isDestroyed?.()) {
        this._notifyProgress(webContents, { type: 'error', error: 'wc_destroyed', mode })
        return { success: false, error: 'wc_destroyed' }
      }
      if (signal?.aborted) {
        this._notifyProgress(webContents, { type: 'error', error: 'aborted', mode })
        return { success: false, error: 'aborted' }
      }
      while (getState && getState() === 'paused') {
        await new Promise(r => setTimeout(r, 100))
        if (signal?.aborted) {
          this._notifyProgress(webContents, { type: 'error', error: 'aborted', mode })
          return { success: false, error: 'aborted' }
        }
      }

      // 通知前端：新一轮思考开始
      const roundIndex = step
      this._notifyProgress(webContents, { type: 'reasoning_start', roundIndex, mode, status: 'running' })

      let response
      try {
        // ===== 流式调用 LLM =====
        response = await this.deepseekService.chatWithToolsStream(
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
          }
        )

        // [DEBUG] 记录 LLM 成功返回
        const successLog = {
          round: roundIndex, status: 'ok',
          content: response.content?.slice(0, 500),
          tool_calls: response.tool_calls?.map(tc => ({ id: tc.id, name: tc.function?.name, args: tc.function?.arguments?.slice(0, 300) })),
          reasoning_content: response.reasoning_content?.slice(0, 300),
        }
        debugLog.push(successLog)
        this._notifyProgress(webContents, { type: 'debug_log', tag: '✅ LLM OK', data: successLog, roundIndex, mode })

      } catch (err) {
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
          await new Promise(r => setTimeout(r, 5000 * Math.pow(2, failureCounters.llmNetwork - 1)))
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

        for (const tc of response.tool_calls) {
          const { name, arguments: argsStr } = tc.function
          let args = {}
          try { args = JSON.parse(argsStr) } catch (e) { args = {} }

          // 通知前端：工具开始执行
          this._notifyProgress(webContents, {
            type: 'tool_start',
            toolCallId: tc.id,
            toolName: name,
            args,
            roundIndex,
            mode,
            status: 'running'
          })

          const skill = this.skillRegistry.getSkill(name)

          if (skill && skill._isMDSkill) {
            const mdInstruction = buildMDInstruction(skill, args)
            const toolContent1 = mdInstruction
            trimmedMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent1 })
            try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolContent1, toolCallId: tc.id }) } catch (_) {}
            this._notifyProgress(webContents, {
              type: 'tool_done',
              toolCallId: tc.id,
              toolName: name,
              args,
              result: { _mdInstruction: true },
              roundIndex,
              mode,
              status: 'running'
            })
          } else if (skill) {
            let execResult
            try {
              // v9.1.0: 传 runtimeCtx（含 sessionId/orchestrator/webContents）给 SkillExecutor
              // - todo_manage 用 sessionId 隔离会话清单
              // - ask_user 用 orchestrator/webContents 跨进程等待用户回答
              execResult = await this.skillExecutor.execute(name, args, {
                sessionId,
                orchestrator: this.orchestrator,
                webContents: this.webContents
              })
            } catch (execErr) {
              execResult = { success: false, error: execErr.message }
            }

            if (execResult && execResult.success === false) {
              // v8.2.2: workspace_readPage 等工具通过 createError 返回 {code, title, hint, recovery, details}
              // 优先读 .title（用户可读消息），再读老的 .message/.error，避免全部丢失后落到"未知错误"兜底
              const errorMsg = typeof execResult.error === 'object'
                ? (execResult.error.title || execResult.error.message || execResult.error.error || JSON.stringify(execResult.error))
                : String(execResult.error || '未知错误')

              // P1-2：失败教训自动记录
              try {
                const LearningService = require('../../services/LearningService')
                LearningService.recordFailure({ skillName: name, args, error: errorMsg }).catch(() => {})
              } catch (_) {}

              failureCounters.skillExec++

              // v8.2.5: 软提醒 — 连续失败 3 次后向 LLM 注入"换路"提示
              // 仅触发 1 次（用 softWarnSent 标志防重复）
              if (failureCounters.skillExec === SOFT_WARN_THRESHOLD && !softWarnSent.skillExec) {
                const warnMsg = `⚠️ 你已在这条路径上连续失败 3 次（工具 "${name}" 执行失败）。请停下分析：失败原因是什么？换一种工具 / 换一套参数 / 换条路径，而不是重试同样的方法。`
                trimmedMessages.push({ role: 'user', content: warnMsg })
                softWarnSent.skillExec = true
              }

              this._notifyProgress(webContents, {
                type: 'tool_error',
                toolCallId: tc.id,
                toolName: name,
                args,
                error: errorMsg,
                roundIndex,
                mode,
                status: 'running'
              })

              if (failureCounters.skillExec >= HARD_FUSE_THRESHOLD) {
                errorHandler.fatal('orchestrator', { counters: failureCounters })
                const toolErrContent1 = JSON.stringify(execResult)
                trimmedMessages.push({ role: 'tool', content: toolErrContent1, tool_call_id: tc.id })
                try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolErrContent1, toolCallId: tc.id }) } catch (_) {}
                finalResult = { reply: `执行"${name}"时连续失败：${errorMsg}`, mode, error: true }
                const classifiedError = classifyError(new Error('max_failures_exceeded: skill execution failures exceeded threshold'), {
                  callSite: 'UnifiedStrategy.skillExec',
                  sessionId,
                })
                this._notifyProgress(webContents, { type: 'error', error: classifiedError, result: finalResult, mode })
                return { success: false, error: classifiedError }
              }

              trimmedMessages.push({ role: 'tool', content: JSON.stringify({ ...execResult, hint: '此步骤执行失败，请尝试其他方法或跳过' }), tool_call_id: tc.id })
              try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: JSON.stringify(execResult), toolCallId: tc.id }) } catch (_) {}
            } else {
              failureCounters.skillExec = 0
              // v8.2.5: 工具成功 → 计数器清零 → 同步重置软提醒标志
              softWarnSent.skillExec = false
              this._notifyProgress(webContents, {
                type: 'tool_done',
                toolCallId: tc.id,
                toolName: name,
                args,
                result: execResult,
                roundIndex,
                mode,
                status: 'running'
              })
              const toolContentOk = JSON.stringify(execResult)
              trimmedMessages.push({ role: 'tool', content: toolContentOk, tool_call_id: tc.id })
              try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolContentOk, toolCallId: tc.id }) } catch (_) {}
            }
          } else {
            this._notifyProgress(webContents, {
              type: 'tool_error',
              toolCallId: tc.id,
              toolName: name,
              args,
              error: `工具 ${name} 不存在`,
              roundIndex,
              mode,
              status: 'running'
            })
            const toolContentMissing = JSON.stringify({ success: false, error: `工具 ${name} 不存在` })
            trimmedMessages.push({ role: 'tool', content: toolContentMissing, tool_call_id: tc.id })
            try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolContentMissing, toolCallId: tc.id }) } catch (_) {}
          }
        }

        // 所有工具执行完毕，继续下一轮 LLM 调用
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

module.exports = UnifiedStrategy
