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

// 调试日志写入文件（打包后 console.log 不可见）
const _fs = require('fs')
const _path = require('path')
const _logFile = _path.join(require('os').homedir(), '.concrete-mixdesign', 'agent-debug.log')
function _log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { _fs.appendFileSync(_logFile, line) } catch (_) {}
  console.log(msg)
}

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

  async execute(input) {
    const { sessionId, message, webContents, signal, getState } = input

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

    let messages = [
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
    messages = trim(messages, { tokenBudget })

    _log(`[UnifiedStrategy] execute start, message="${message.slice(0, 50)}", messages=${messages.length}, skills=${skillNames.length}`)

    // 2. 主循环
    for (let step = 0; step < 10; step++) {
      _log(`[UnifiedStrategy] step=${step}, state=${getState?.()}`)
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

      let response
      try {
        _log(`[UnifiedStrategy] calling chatWithTools, messages=${messages.length}, tools=${this.skillRegistry.getToolSchemas().length}`)
        response = await this.deepseekService.chatWithTools(
          messages,
          this.skillRegistry.getToolSchemas()
        )
        _log(`[UnifiedStrategy] API response: content=${typeof response?.content}(${response?.content?.length || 0}chars), tool_calls=${response?.tool_calls?.length || 0}`)
      } catch (err) {
        _log(`[UnifiedStrategy] API error: ${err.message}`)
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

      // 3. 处理 tool_calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        _log(`[UnifiedStrategy] LLM returned ${response.tool_calls.length} tool_calls`)
        for (const tc of response.tool_calls) {
          const { name, arguments: argsStr } = tc.function
          let args = {}
          try { args = JSON.parse(argsStr) } catch (e) { args = {} }
          _log(`[UnifiedStrategy] executing tool: ${name}, args: ${JSON.stringify(args).slice(0, 200)}`)

          const skill = this.skillRegistry.getSkill(name)

          if (skill && skill._isMDSkill) {
            const mdInstruction = buildMDInstruction(skill, args)
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: mdInstruction
            })
          } else if (skill) {
            let execResult
            try {
              execResult = await this.skillExecutor.execute(name, args, sessionId)
              _log(`[UnifiedStrategy] tool ${name} result: success=${execResult?.success}, hasData=${!!execResult?.data}`)
            } catch (execErr) {
              _log(`[UnifiedStrategy] tool ${name} threw: ${execErr.message}`)
              execResult = { success: false, error: execErr.message }
            }
            if (execResult && execResult.success === false) {
              failureCounters.skillExec++
              _log(`[UnifiedStrategy] tool ${name} FAILED (${failureCounters.skillExec}/${threshold}): ${execResult.error}`)
              if (failureCounters.skillExec >= threshold) {
                errorHandler.fatal('orchestrator', { counters: failureCounters })
                return { success: false, error: 'max_failures_exceeded' }
              }
            } else {
              failureCounters.skillExec = 0
            }
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(execResult)
            })
          } else {
            _log(`[UnifiedStrategy] tool ${name} NOT FOUND in registry`)
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ success: false, error: `工具 ${name} 不存在` })
            })
          }
        }
        _log(`[UnifiedStrategy] all tools done, messages=${messages.length}, continuing...`)
        continue
      }

      // 4. 直接结束
      _log(`[UnifiedStrategy] returning content, length=${response.content?.length || 0}`)
      return { success: true, content: response.content }
    }

    _log(`[UnifiedStrategy] max steps exceeded`)
    return { success: false, error: 'max_steps_exceeded' }
  }
}

module.exports = UnifiedStrategy
