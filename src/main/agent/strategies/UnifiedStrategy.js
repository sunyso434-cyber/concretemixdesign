/**
 * UnifiedStrategy - 单 agent 主循环
 *
 * 从 UnifiedOrchestrator.run() 迁入。
 * 委托给：
 * - systemPromptBuilder.buildSystemPrompt()
 * - mdInstructionBuilder.buildMDInstruction()
 */

const { buildSystemPrompt } = require('../systemPromptBuilder')
const { buildMDInstruction } = require('../mdInstructionBuilder')

class UnifiedStrategy {
  constructor({ deepseekService, skillRegistry, skillExecutor, agentMemoryService }) {
    this.deepseekService = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor
    this.agentMemoryService = agentMemoryService
  }

  async execute(input) {
    const { sessionId, message, webContents } = input
    let consecutiveFailures = 0
    const MAX_CONSECUTIVE_FAILURES = 2

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

    // 2. 主循环
    for (let step = 0; step < 10; step++) {
      if (webContents?.isDestroyed?.()) {
        return { success: false, error: 'wc_destroyed' }
      }

      let response
      try {
        response = await this.deepseekService.chatWithTools({
          messages,
          tools: this.skillRegistry.getToolSchemas()
        })
      } catch (err) {
        consecutiveFailures++
        // 429 退避
        if (err.status === 429 && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
          await new Promise(r => setTimeout(r, 5000 * Math.pow(2, consecutiveFailures - 1)))
          continue
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return { success: false, error: 'max_failures_exceeded' }
        }
        continue
      }

      // 成功：重置计数
      consecutiveFailures = 0

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
