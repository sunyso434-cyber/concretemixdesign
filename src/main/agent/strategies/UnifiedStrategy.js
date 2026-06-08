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

const DEFAULT_TOKEN_BUDGET = 30000

class UnifiedStrategy {
  constructor({ deepseekService, skillRegistry, skillExecutor, agentMemoryService, systemService }) {
    this.deepseekService = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor
    this.agentMemoryService = agentMemoryService
    this.systemService = systemService || null
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
    const threshold = 2

    // 1. 构造 messages
    const memoryContext = await this.agentMemoryService.buildMemoryContext(sessionId, {
      queryContext: { lastUserMessage: message }
    })
    const historyMessages = await this.agentMemoryService.buildHistoryMessages(sessionId)
    const skillNames = this.skillRegistry.getToolSchemas().map(s => s.function.name)

    const systemPrompt = buildSystemPrompt({ memoryContext, skillNames, preferences: {} })

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

    // 保存用户消息到对话历史
    try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: message }) } catch (_) {}

    let finalResult = null

    // 2. 主循环（流式）
    const toolSchemas = this.skillRegistry.getToolSchemas()

    for (let step = 0; step < 10; step++) {
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

        if (err.status === 429 || err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          failureCounters.llmNetwork++
        } else {
          failureCounters.llmParse++
        }

        if (err.status === 429 && failureCounters.llmNetwork < threshold) {
          await new Promise(r => setTimeout(r, 5000 * Math.pow(2, failureCounters.llmNetwork - 1)))
          continue
        }

        if (failureCounters.llmParse >= threshold || failureCounters.llmNetwork >= threshold) {
          errorHandler.fatal('orchestrator', { counters: failureCounters })
          this._notifyProgress(webContents, { type: 'error', error: 'max_failures_exceeded', mode })
          return { success: false, error: 'max_failures_exceeded' }
        }
        continue
      }

      failureCounters.llmParse = 0
      failureCounters.llmNetwork = 0

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
              const errorMsg = typeof execResult.error === 'object'
                ? (execResult.error.message || execResult.error.error || JSON.stringify(execResult.error))
                : String(execResult.error || '未知错误')
              failureCounters.skillExec++

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

              if (failureCounters.skillExec >= threshold) {
                errorHandler.fatal('orchestrator', { counters: failureCounters })
                const toolErrContent1 = JSON.stringify(execResult)
                trimmedMessages.push({ role: 'tool', content: toolErrContent1, tool_call_id: tc.id })
                try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolErrContent1, toolCallId: tc.id }) } catch (_) {}
                finalResult = { reply: `执行"${name}"时连续失败：${errorMsg}`, mode, error: true }
                this._notifyProgress(webContents, { type: 'error', error: 'max_failures_exceeded', result: finalResult, mode })
                return { success: false, error: 'max_failures_exceeded' }
              }

              trimmedMessages.push({ role: 'tool', content: JSON.stringify({ ...execResult, hint: '此步骤执行失败，请尝试其他方法或跳过' }), tool_call_id: tc.id })
              try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: JSON.stringify(execResult), toolCallId: tc.id }) } catch (_) {}
            } else {
              failureCounters.skillExec = 0
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

    this._notifyProgress(webContents, { type: 'error', error: 'max_steps_exceeded', mode })
    return { success: false, error: 'max_steps_exceeded' }
  }
}

module.exports = UnifiedStrategy
