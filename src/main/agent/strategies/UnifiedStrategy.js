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
    // systemService 可选注入（E2）：用于读 messageTrimmerTokenBudget；
    // 未注入时 trim 走 messageTrimmer 内置默认值。
    this.systemService = systemService || null
  }

  async execute(input) {
    const { sessionId, message, webContents, signal, getState } = input

    // 拆 3 个独立计数器（解决 P1-1 errorSource 区分）
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

    // E2: 入口处按 tokenBudget 截断（system + 最新 2 轮必保留；中间 tool result 优先丢）
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

    // 2. 主循环
    for (let step = 0; step < 10; step++) {
      if (webContents?.isDestroyed?.()) {
        return { success: false, error: 'wc_destroyed' }
      }

      // P1: abort 检查（Orchestrator 通过 AbortSignal 通知）
      if (signal?.aborted) {
        return { success: false, error: 'aborted' }
      }
      // pause 阻塞：state 由 Orchestrator 外壳维护，策略通过 getState 回调读
      while (getState && getState() === 'paused') {
        await new Promise(r => setTimeout(r, 100))
        if (signal?.aborted) return { success: false, error: 'aborted' }
      }

      let response
      try {
        response = await this.deepseekService.chatWithTools({
          messages,
          tools: this.skillRegistry.getToolSchemas()
        })
      } catch (err) {
        // 区分错误源：429/超时/网络 → llmNetwork；其他 → llmParse
        if (err.status === 429 || err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          failureCounters.llmNetwork++
        } else {
          failureCounters.llmParse++
        }

        // 429 退避（网络类有自恢复机会）
        if (err.status === 429 && failureCounters.llmNetwork < threshold) {
          await new Promise(r => setTimeout(r, 5000 * Math.pow(2, failureCounters.llmNetwork - 1)))
          continue
        }

        // 升级判断：任一计数器 >= threshold → fatal
        if (failureCounters.llmParse >= threshold || failureCounters.llmNetwork >= threshold) {
          errorHandler.fatal('orchestrator', { counters: failureCounters })
          return { success: false, error: 'max_failures_exceeded' }
        }
        continue
      }

      // 成功：仅重置 LLM 计数器（skillExec 计数器有自己的阈值）
      failureCounters.llmParse = 0
      failureCounters.llmNetwork = 0

      // 3. 处理 tool_calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const tc of response.tool_calls) {
          const { name, arguments: argsStr } = tc.function
          let args = {}
          try { args = JSON.parse(argsStr) } catch (e) { args = {} }

          const skill = this.skillRegistry.getSkill(name)

          if (skill && skill._isMDSkill) {
            // MD 技能：注入指令
            const mdInstruction = buildMDInstruction(skill, args)
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: mdInstruction
            })
          } else if (skill) {
            // JS 技能：调执行器
            const execResult = await this.skillExecutor.execute(skill, args, sessionId)
            if (execResult && execResult.success === false) {
              failureCounters.skillExec++
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
          }
        }
        continue
      }

      // 4. 直接结束
      return { success: true, content: response.content }
    }

    return { success: false, error: 'max_steps_exceeded' }
  }
}

module.exports = UnifiedStrategy
