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
   * 清理消息对象，保留 reasoning_content（DeepSeek thinking 模式需要）
   */
  _cleanMessage(msg) {
    const cleaned = {
      role: msg.role,
      content: msg.content || null
    }
    if (msg.reasoning_content) cleaned.reasoning_content = msg.reasoning_content
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

    // 步骤跟踪
    const steps = []
    let stepCount = 0
    let latestReasoning = ''
    let finalResult = null

    // 2. 主循环
    for (let step = 0; step < 10; step++) {
      if (webContents?.isDestroyed?.()) {
        return { success: false, error: 'wc_destroyed' }
      }
      if (signal?.aborted) {
        return { success: false, error: 'aborted' }
      }
      while (getState && getState() === 'paused') {
        await new Promise(r => setTimeout(r, 100))
        if (signal?.aborted) return { success: false, error: 'aborted' }
      }

      stepCount++
      const stepData = { step: stepCount, status: 'running', toolName: null, reasoning: null, result: null, error: null }
      steps.push(stepData)
      this._notifyProgress(webContents, { steps: [...steps], mode, status: 'running', latestReasoning })

      let response
      try {
        response = await this.deepseekService.chatWithTools(trimmedMessages, this.skillRegistry.getToolSchemas())
      } catch (err) {
        stepData.status = 'error'
        stepData.error = err.message
        this._notifyProgress(webContents, { steps: [...steps], mode, status: 'running', latestReasoning })

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
          return { success: false, error: 'max_failures_exceeded' }
        }
        continue
      }

      failureCounters.llmParse = 0
      failureCounters.llmNetwork = 0

      // 3. LLM 返回纯文本（无工具调用）→ 任务完成
      if (response.content && (!response.tool_calls || response.tool_calls.length === 0)) {
        stepData.status = 'done'
        stepData.reasoning = response.content
        latestReasoning = response.content
        finalResult = { reply: response.content, steps, mode }
        this._notifyProgress(webContents, { steps: [...steps], mode, status: 'done', latestReasoning, result: finalResult })
        return { success: true, content: response.content }
      }

      // 4. LLM 要调用工具
      if (response.tool_calls && response.tool_calls.length > 0) {
        // 捕获 LLM 的推理文字
        if (response.content) {
          stepData.reasoning = response.content
          latestReasoning = response.content
          this._notifyProgress(webContents, { steps: [...steps], mode, status: 'running', latestReasoning })
        }

        // 标记外层 step 为推理容器（渲染时被 filter 跳过）
        stepData.type = 'reasoning'
        stepData.status = 'done'

        // assistant 消息只推一次（包含所有 tool_calls）
        trimmedMessages.push(this._cleanMessage(response))

        for (const tc of response.tool_calls) {
          const { name, arguments: argsStr } = tc.function
          let args = {}
          try { args = JSON.parse(argsStr) } catch (e) { args = {} }

          // 每个 tool call 创建独立的 step
          const toolStep = { step: stepCount, status: 'running', toolName: name, reasoning: null, result: null, error: null }
          steps.push(toolStep)
          this._notifyProgress(webContents, { steps: [...steps], mode, status: 'running', latestReasoning })

          const skill = this.skillRegistry.getSkill(name)

          if (skill && skill._isMDSkill) {
            const mdInstruction = buildMDInstruction(skill, args)
            trimmedMessages.push({ role: 'tool', tool_call_id: tc.id, content: mdInstruction })
            toolStep.status = 'done'
            toolStep.result = { _mdInstruction: true }
          } else if (skill) {
            let execResult
            try {
              execResult = await this.skillExecutor.execute(name, args, sessionId)
            } catch (execErr) {
              execResult = { success: false, error: execErr.message }
            }

            if (execResult && execResult.success === false) {
              toolStep.status = 'error'
              const errorMsg = typeof execResult.error === 'object'
                ? (execResult.error.message || execResult.error.error || JSON.stringify(execResult.error))
                : String(execResult.error || '未知错误')
              toolStep.error = errorMsg
              failureCounters.skillExec++

              if (failureCounters.skillExec >= threshold) {
                errorHandler.fatal('orchestrator', { counters: failureCounters })
                trimmedMessages.push({ role: 'tool', content: JSON.stringify(execResult), tool_call_id: tc.id })
                finalResult = { reply: `执行"${name}"时连续失败：${errorMsg}`, steps, mode, error: true }
                this._notifyProgress(webContents, { steps: [...steps], mode, status: 'error', latestReasoning, result: finalResult })
                return { success: false, error: 'max_failures_exceeded' }
              }

              trimmedMessages.push({ role: 'tool', content: JSON.stringify({ ...execResult, hint: '此步骤执行失败，请尝试其他方法或跳过' }), tool_call_id: tc.id })
            } else {
              toolStep.status = 'done'
              toolStep.result = execResult
              failureCounters.skillExec = 0
              trimmedMessages.push({ role: 'tool', content: JSON.stringify(execResult), tool_call_id: tc.id })
            }
          } else {
            toolStep.status = 'error'
            toolStep.error = `工具 ${name} 不存在`
            trimmedMessages.push({ role: 'tool', content: JSON.stringify({ success: false, error: `工具 ${name} 不存在` }), tool_call_id: tc.id })
          }

          // 推送工具执行后的进度
          this._notifyProgress(webContents, { steps: [...steps], mode, status: 'running', latestReasoning })
        }

        // 所有工具执行完毕，继续下一轮 LLM 调用
        continue
      }

      // 5. LLM 既没有内容也没有工具调用
      stepData.status = 'done'
      return { success: true, content: response.content || '' }
    }

    return { success: false, error: 'max_steps_exceeded' }
  }
}

module.exports = UnifiedStrategy
