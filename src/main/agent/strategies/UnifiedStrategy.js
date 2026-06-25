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

const { buildSystemPrompt } = require('../systemPromptBuilder')
const { buildMDInstruction } = require('../mdInstructionBuilder')
const { trim } = require('../messageTrimmer')
const errorHandler = require('../../utils/errorHandler')
const { DEFAULT_AGENT_MAX_STEPS } = require('../../utils/agentConstants')
const { getInstance: getAgentMdService } = require('../agentMd')
const { classifyError } = require('../errorClassifier')

const DEFAULT_TOKEN_BUDGET = 150000

class UnifiedStrategy {
  constructor({ deepseekService, skillRegistry, skillExecutor, agentMemoryService, systemService }) {
    this.deepseekService = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor
    this.agentMemoryService = agentMemoryService
    this.systemService = systemService || null
    this.agentMdService = getAgentMdService()
  }

  /**
   * 向渲染进程推送进度事件
   */
  _notifyProgress(webContents, data) {
    if (webContents && !webContents.isDestroyed?.()) {
      try {
        webContents.send('agent:progress', data)
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
    const { sessionId, message, webContents, signal, getState, mode } = input

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
    const memoryContext = await this.agentMemoryService.buildMemoryContext(sessionId, {
      queryContext: { lastUserMessage: message }
    })
    const historyMessages = await this.agentMemoryService.buildHistoryMessages(sessionId)
    const skillNames = this.skillRegistry.getToolSchemas().map(s => s.function.name)

    const systemPrompt = buildSystemPrompt({
      memoryContext,
      skillNames,
      agentMdRules: this.agentMdService.getFormattedRules()
    })

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message }
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
      } catch (err) {
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
          errorHandler.fatal('orchestrator', { counters: failureCounters })
          const classifiedError = classifyError(new Error('max_failures_exceeded: LLM parse/network failures exceeded threshold'), {
            callSite: 'UnifiedStrategy.llmLoop',
            sessionId,
          })
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
              execResult = await this.skillExecutor.execute(name, args, sessionId)
            } catch (execErr) {
              execResult = { success: false, error: execErr.message }
            }

            if (execResult && execResult.success === false) {
              // v8.2.2: workspace_readPage 等工具通过 createError 返回 {code, title, hint, recovery, details}
              // 优先读 .title（用户可读消息），再读老的 .message/.error，避免全部丢失后落到"未知错误"兜底
              const errorMsg = typeof execResult.error === 'object'
                ? (execResult.error.title || execResult.error.message || execResult.error.error || JSON.stringify(execResult.error))
                : String(execResult.error || '未知错误')
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
