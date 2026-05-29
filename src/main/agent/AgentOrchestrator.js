const ToolRegistry = require('./ToolRegistry')
const agentMemoryService = require('../services/AgentMemoryService')

const MAX_STEPS = 10
const MAX_CONSECUTIVE_FAILURES = 2

class AgentOrchestrator {
  constructor({ deepseekService, toolRegistry }) {
    this.ds = deepseekService
    this.registry = toolRegistry
    this.wc = null
    this._paused = false
    this._aborted = false
    this._resumeResolver = null
    this._confirmationResolver = null
  }

  async run({ sessionId, message, mode = 'collaborative', webContents = null }) {
    this.wc = webContents
    this._paused = false
    this._aborted = false
    this._resumeResolver = null

    const steps = []
    const startTime = Date.now()
    let consecutiveFailures = 0

    console.log('[Agent] run() 开始, sessionId:', sessionId, 'mode:', mode, 'wc:', !!webContents)

    try {
      await agentMemoryService.saveMessage({ sessionId, role: 'user', content: message })

    const memoryContext = await agentMemoryService.buildMemoryContext(sessionId)
    console.log('[Agent] memoryContext 长度:', memoryContext?.length || 0)
    const historyMessages = await agentMemoryService.buildHistoryMessages(sessionId)
    console.log('[Agent] historyMessages 数量:', historyMessages.length)
    const resourceSummary = await agentMemoryService.getResourceSummary().catch(() => null)
    const systemPrompt = this._buildSystemPrompt(memoryContext, mode, resourceSummary)
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message }
    ]
    console.log('[Agent] messages 数组长度:', messages.length)

    let stepCount = 0
    let finalResult = null

    while (stepCount < MAX_STEPS && !this._aborted) {
      if (this._paused) {
        await this._waitForResume()
        if (this._aborted) break
      }

      stepCount++
      const step = { step: stepCount, status: 'running', toolName: null, reasoning: null, result: null, error: null }
      steps.push(step)
      this._notifyProgress({ steps, mode, status: 'running' })

      try {
        console.log('[Agent] 调用 chatWithTools, step:', stepCount)
        const response = await this.ds.chatWithTools(messages, this.registry.getToolSchemas())
        console.log('[Agent] API 响应:', response ? `content=${!!response.content}, tool_calls=${response.tool_calls?.length || 0}` : 'null')
        if (!response) {
          step.status = 'error'
          step.error = 'DeepSeek API 返回空响应'
          finalResult = { reply: 'AI服务返回空响应，请重试', steps, mode, error: true }
          break
        }

        // LLM 决定任务完成 —— 输出纯文本回复
        if (response.content && !response.tool_calls) {
          step.status = 'done'
          step.reasoning = response.content
          finalResult = { reply: response.content, steps, mode, duration: Date.now() - startTime }
          break
        }

        // LLM 要调用工具
        if (response.tool_calls && response.tool_calls.length > 0) {
          // 捕获 LLM 的推理文字（如果有的话）
          if (response.content) {
            step.reasoning = response.content
            this._notifyProgress({ steps, mode, status: 'running', latestReasoning: response.content })
          }

          // assistant 消息只推一次（包含所有 tool_calls）
          messages.push(this._cleanMessage(response))
          // 保存到记忆
          const toolNames = (response.tool_calls || []).map(t => t.function.name).join(',')
          agentMemoryService.saveMessage({
            sessionId,
            role: 'assistant',
            content: response.content || `调用工具: ${toolNames}`,
            toolCalls: response.tool_calls || null
          }).catch(() => {})

          for (const tc of response.tool_calls) {
            step.toolName = tc.function.name

            // 解析工具参数
            let args
            try {
              args = JSON.parse(tc.function.arguments)
            } catch (_) {
              // JSON 解析失败时，需要为这个 tool_call 提供 tool 响应
              messages.push({ role: 'tool', content: JSON.stringify({ error: '参数格式错误' }), tool_call_id: tc.id })
              step.status = 'error'
              step.error = 'LLM 工具参数格式错误'
              consecutiveFailures++
              break
            }

            // 协作模式确认
            const toolMeta = this.registry.getToolMeta(tc.function.name)
            if (mode === 'collaborative' && toolMeta?.requiresConfirmation) {
              const confirmed = await this._requestConfirmation(tc.function.name, args)
              if (!confirmed) {
                step.status = 'skipped'
                step.result = '用户拒绝了此步骤的执行'
                messages.push({ role: 'tool', content: JSON.stringify({ skipped: true }), tool_call_id: tc.id })
                continue
              }
            }

            // 执行工具
            const execResult = await this.registry.execute(tc.function.name, args)
            step.result = execResult

            if (execResult.success === false) {
              step.status = 'error'
              step.error = execResult.error
              consecutiveFailures++

              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                // 先推这个工具的错误响应，保证 tool_call_id 配对
                messages.push({ role: 'tool', content: JSON.stringify(execResult), tool_call_id: tc.id })
                // 如果还有未处理的 tool_call，给它们填充空响应
                for (let j = response.tool_calls.indexOf(tc) + 1; j < response.tool_calls.length; j++) {
                  messages.push({ role: 'tool', content: JSON.stringify({ error: '任务已终止' }), tool_call_id: response.tool_calls[j].id })
                }
                finalResult = {
                  reply: `执行"${step.toolName}"时连续失败 ${consecutiveFailures} 次：${execResult.error}\n\n请检查输入参数是否正确，或手动处理此步骤后继续。`,
                  steps, mode, error: true, duration: Date.now() - startTime
                }
                break
              }

              // 单次失败
              messages.push({ role: 'tool', content: JSON.stringify({ ...execResult, hint: '此步骤执行失败，请尝试其他方法或跳过' }), tool_call_id: tc.id })
            } else {
              step.status = 'done'
              consecutiveFailures = 0
              messages.push({ role: 'tool', content: JSON.stringify(execResult), tool_call_id: tc.id })
            }
          }

          // 如果触发了连续失败退出，跳出外层循环
          if (finalResult) break
        }

      } catch (error) {
        step.status = 'error'
        step.error = error.message

        if (error.message?.includes('timeout') || error.code === 'ECONNABORTED') {
          consecutiveFailures++
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            finalResult = { reply: 'AI服务连续超时，请检查网络后重试', steps, mode, error: true }
            break
          }
          continue
        }

        if (error.response?.status === 429) {
          await new Promise(r => setTimeout(r, 5000))
          continue
        }

        finalResult = { reply: `执行出错: ${error.message}`, steps, mode, error: true }
        break
      }
    }

    if (stepCount >= MAX_STEPS && !finalResult) {
      finalResult = { reply: '任务步骤已达上限，你可以查看已完成步骤并继续。', steps, mode, truncated: true, duration: Date.now() - startTime }
    }

    if (this._aborted && !finalResult) {
      finalResult = { reply: '任务已取消', steps, mode, aborted: true, duration: Date.now() - startTime }
    }

    // 保存最终回复到记忆
    await agentMemoryService.saveMessage({
      sessionId,
      role: 'assistant',
      content: finalResult?.reply || '',
      metadata: { steps, mode, duration: Date.now() - startTime }
    })

    this._notifyProgress({ steps, mode, status: 'done', result: finalResult })
    return finalResult

    } catch (outerError) {
      console.error('[Agent] run() 顶层异常:', outerError.message)
      const errorResult = { reply: `Agent 执行异常: ${outerError.message}`, steps, mode, error: true, duration: Date.now() - startTime }
      this._notifyProgress({ steps, mode, status: 'error', result: errorResult, error: outerError.message })
      return errorResult
    }
  }

  // ===== 控制 =====

  pause() { this._paused = true }
  resume() {
    this._paused = false
    if (this._resumeResolver) { const r = this._resumeResolver; this._resumeResolver = null; r() }
  }
  abort() {
    this._aborted = true; this._paused = false
    if (this._resumeResolver) { const r = this._resumeResolver; this._resumeResolver = null; r() }
  }
  get isPaused() { return this._paused }
  get isAborted() { return this._aborted }

  resolveConfirmation(confirmed, args) {
    if (this._confirmationResolver) {
      this._confirmationResolver(confirmed, args)
    }
  }

  // ===== 内部 =====

  _buildSystemPrompt(memoryContext, mode, resourceSummary) {
    // 构建资源感知摘要
    const buildResourceText = (summary) => {
      if (!summary) return ''
      const parts = ['\n你拥有以下知识资源（需要时请主动调用对应工具查询，不要凭记忆回答专业问题）：']

      if (summary.standardsCount > 0) {
        parts.push(`- 规范知识库：已加载 ${summary.standardsCount} 个规范，可用 query_standards 检索条款`)
      } else {
        parts.push('- 规范知识库：暂无已加载规范')
      }

      if (summary.designHistoryCount > 0) {
        parts.push(`- 历史设计：共 ${summary.designHistoryCount} 条配合比记录，可用 query_design_history 查找类似方案`)
      } else {
        parts.push('- 历史设计：暂无历史设计记录')
      }

      parts.push('- 合规审查：可用 query_compliance_check 校验方案是否符合规范')

      // 用户偏好摘要
      const prefs = summary.userPreferences || {}
      const prefLines = []
      if (prefs.commonStrengthGrades?.length > 0) {
        prefLines.push(`- 常用强度等级：${prefs.commonStrengthGrades.join('、')}`)
      }
      if (prefs.cement) {
        prefLines.push(`- 常用水泥：${prefs.cement}`)
      }
      if (prefs.flyAsh) {
        prefLines.push(`- 常用粉煤灰：${prefs.flyAsh}`)
      }
      if (prefLines.length > 0) {
        parts.push('\n用户常用信息（来自历史操作记录）：')
        parts.push(...prefLines)
      }

      return parts.join('\n')
    }

    const resourceText = buildResourceText(resourceSummary)

    const toolList = this.registry.toolNames.join('、')
    const modeInstruction = mode === 'auto'
      ? '全自动模式：自主完成所有步骤。每个步骤调用工具前，先用简短文字说明你这一步要做什么、为什么。'
      : '协作模式：每个关键操作执行前需要用户确认。每个步骤调用工具前，先用简短文字说明你这一步要做什么、为什么。'

    return `你是混凝土配合比设计的AI专家助手。可用工具：${toolList}。

${modeInstruction}

${resourceText}

${memoryContext || ''}

重要——先理解再行动：
0. 用户说的话不一定是任务指令。如果用户只是在询问、讨论、确认细节、补充信息、或闲聊，先以纯文本回复，不要调用任何工具
1. 只有当用户明确表达了执行意图，才调用工具执行。只做用户要求的事，不要擅自添加额外步骤
2. 不确定用户意图时，先回复询问澄清，而不是猜测并执行
3. calculate_mix_design 已经给出了完整配比方案。optimize_mix_cost（成本优化）和 check_compliance（规范审查）都是额外步骤，只有用户明确要求时才执行，不要自动追加
4. 每次只调用一个工具，调用前用简短文字说明理由
5. 工具执行失败时，尝试换一种方式，但不要连续失败超过2次
6. 任务完成后，给出简洁的总结，包含关键参数和结论。可以问用户是否需要进一步优化，但不要自动执行
7. 工具参数必须是合法的 JSON 格式
8. 专业问题（规范限值、标准要求）必须先查 query_standards，不要凭记忆回答
9. 参考历史方案时，先查 query_design_history 获取真实记录
10. 设计完成后，主动询问用户是否需要规范合规检查（query_compliance_check）`
  }

  _waitForResume() {
    return new Promise(resolve => { this._resumeResolver = resolve })
  }

  // 清理 API 响应消息，移除可能导致 400 的字段
  _cleanMessage(msg) {
    if (!msg || typeof msg !== 'object') return msg
    const cleaned = { role: msg.role }
    if (msg.content != null && msg.content !== '') cleaned.content = msg.content
    if (msg.tool_calls) {
      cleaned.tool_calls = msg.tool_calls.map(tc => ({
        id: tc.id,
        type: tc.type || 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments }
      }))
    }
    if (msg.tool_call_id) cleaned.tool_call_id = msg.tool_call_id
    if (msg.name) cleaned.name = msg.name
    // DeepSeek v4 thinking 模式要求传回 reasoning_content
    if (msg.reasoning_content) cleaned.reasoning_content = msg.reasoning_content
    return cleaned
  }

  _notifyProgress(data) {
    if (!this.wc || this.wc.isDestroyed()) return
    try { this.wc.send('agent:progress', data) } catch (_) {}
  }

  async _requestConfirmation(toolName, args) {
    if (!this.wc || this.wc.isDestroyed()) return true

    return new Promise(resolve => {
      let settled = false

      const settle = (val) => {
        if (settled) return
        settled = true
        this._confirmationResolver = null
        resolve(val)
      }

      // 60 秒超时自动拒绝
      const timer = setTimeout(() => settle(false), 60000)

      this._confirmationResolver = (confirmed, extraArgs) => {
        clearTimeout(timer)
        settle(confirmed ? (extraArgs || true) : false)
      }

      try {
        this.wc.send('agent:confirmation-request', { toolName, args })
      } catch (_) {
        clearTimeout(timer)
        settle(true)
      }
    })
  }
}

module.exports = AgentOrchestrator
