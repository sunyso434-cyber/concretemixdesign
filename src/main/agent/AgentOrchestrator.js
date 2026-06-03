const agentMemoryService = require('../services/AgentMemoryService')
const eventBus = require('./EventBus')

// 默认配置（无 systemService 注入时使用）
const DEFAULT_CONFIG = {
  maxSteps: 10,
  maxConsecutiveFailures: 2,
  rateLimitBaseMs: 5000,
  rateLimitMaxMs: 30000,
  confirmationTimeoutMs: 120000
}

class AgentOrchestrator {
  constructor({ deepseekService, skillRegistry, skillExecutor, systemService = null }) {
    this.ds = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor || null
    this.systemService = systemService
    this._agentCfg = null
    this.wc = null
    this._paused = false
    this._aborted = false
    this._resumeResolver = null
    this._confirmationResolver = null
  }

  /**
   * 加载 Agent 配置（maxSteps / maxConsecutiveFailures / rateLimit* / confirmationTimeout）
   * 有 systemService 时从 SystemService 拉，缺失则用默认。
   */
  async _loadAgentConfig() {
    if (this._agentCfg) return this._agentCfg
    if (!this.systemService) {
      this._agentCfg = { ...DEFAULT_CONFIG }
    } else {
      try {
        const all = await this.systemService.getAgentConfig()
        this._agentCfg = {
          maxSteps: all.agentMaxSteps,
          maxConsecutiveFailures: all.agentMaxConsecutiveFailures,
          rateLimitBaseMs: all.agentRateLimitBaseMs,
          rateLimitMaxMs: all.agentRateLimitMaxMs,
          confirmationTimeoutMs: all.agentConfirmationTimeoutMs
        }
      } catch (err) {
        console.warn('[AgentOrchestrator] 加载 agent 配置失败，使用默认值:', err.message)
        this._agentCfg = { ...DEFAULT_CONFIG }
      }
    }
    return this._agentCfg
  }

  async run({ sessionId, message, mode = 'collaborative', webContents = null }) {
    this.wc = webContents
    this._paused = false
    this._aborted = false
    this._resumeResolver = null
    this._mdSkillStack = []  // 重置MD技能栈，防止跨对话的误判

    // 读取 agent 配置（maxSteps / maxConsecutiveFailures / rateLimit* / confirmationTimeout）
    const cfg = await this._loadAgentConfig()

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
    let rateLimitCount = 0

    while (stepCount < cfg.maxSteps && !this._aborted) {
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
        const response = await this.ds.chatWithTools(messages, this.skillRegistry.getToolSchemas())
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

          // 标记外层 step 为推理容器（渲染时被 filter 跳过，不显示）
          step.type = 'reasoning'

          for (const tc of response.tool_calls) {
            // 每个 tool call 创建独立的 step，共享同一个逻辑步骤号
            const toolStep = { step: stepCount, status: 'running', toolName: tc.function.name, reasoning: null, result: null, error: null }
            steps.push(toolStep)
            this._notifyProgress({ steps, mode, status: 'running' })

            // 解析工具参数
            let args
            try {
              args = JSON.parse(tc.function.arguments)
            } catch (_) {
              messages.push({ role: 'tool', content: JSON.stringify({ error: '参数格式错误' }), tool_call_id: tc.id })
              toolStep.status = 'error'
              toolStep.error = 'LLM 工具参数格式错误'
              consecutiveFailures++
              break
            }

            // 协作模式确认
            const toolMeta = this.skillRegistry.getSkillMeta(tc.function.name)
            if (mode === 'collaborative' && toolMeta?.requiresConfirmation) {
              const confirmed = await this._requestConfirmation(tc.function.name, args)
              if (!confirmed) {
                toolStep.status = 'skipped'
                toolStep.result = '用户拒绝了此步骤的执行'
                messages.push({ role: 'tool', content: JSON.stringify({ skipped: true }), tool_call_id: tc.id })
                continue
              }
            }

            // 检查是否是MD技能
            const skill = this.skillRegistry.getSkill(tc.function.name)
            if (skill && skill._isMDSkill) {
              // 检查是否正在执行同一个MD技能（防递归）
              if (this._mdSkillStack.includes(tc.function.name)) {
                toolStep.status = 'error'
                toolStep.error = `MD技能 ${tc.function.name} 正在执行中，防止无限递归`
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({
                    success: false,
                    error: `MD技能 ${tc.function.name} 正在执行中，防止无限递归`
                  })
                })
                consecutiveFailures++
              } else {
                // MD技能走"注入指令"路径
                this._mdSkillStack.push(tc.function.name)
                const mdInstruction = this._buildMDInstruction(skill, args)

                // 把指令作为tool result发回去，保持消息格式合法
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: mdInstruction
                })

                toolStep.status = 'done'
                toolStep.result = { _mdInstruction: true }
                consecutiveFailures = 0
              }
            } else {
              // JS技能走原有的execute路径
              const execResult = await this.skillExecutor.execute(tc.function.name, args)
              toolStep.result = execResult

              if (execResult.success === false) {
                toolStep.status = 'error'
                // 确保 error 始终是字符串（技能可能返回对象格式）
                const errorMsg = typeof execResult.error === 'object'
                  ? (execResult.error.message || execResult.error.error || JSON.stringify(execResult.error))
                  : String(execResult.error || '未知错误')
                toolStep.error = errorMsg
                consecutiveFailures++

                if (consecutiveFailures >= cfg.maxConsecutiveFailures) {
                  messages.push({ role: 'tool', content: JSON.stringify(execResult), tool_call_id: tc.id })
                  for (let j = response.tool_calls.indexOf(tc) + 1; j < response.tool_calls.length; j++) {
                    messages.push({ role: 'tool', content: JSON.stringify({ error: '任务已终止' }), tool_call_id: response.tool_calls[j].id })
                  }
                  finalResult = {
                    reply: `执行"${tc.function.name}"时连续失败 ${consecutiveFailures} 次：${errorMsg}\n\n请检查输入参数是否正确，或手动处理此步骤后继续。`,
                    steps, mode, error: true, duration: Date.now() - startTime
                  }
                  break
                }

                messages.push({ role: 'tool', content: JSON.stringify({ ...execResult, hint: '此步骤执行失败，请尝试其他方法或跳过' }), tool_call_id: tc.id })
              } else {
                toolStep.status = 'done'
                consecutiveFailures = 0
                messages.push({ role: 'tool', content: JSON.stringify(execResult), tool_call_id: tc.id })
                eventBus.emitToolExecuted(tc.function.name, args, execResult)
              }
            }
          }

          // 推理容器 step 状态跟随工具执行结果
          step.status = finalResult?.error ? 'error' : 'done'
          if (finalResult) break
        }

      } catch (error) {
        step.status = 'error'
        step.error = error.message

        if (error.message?.includes('timeout') || error.code === 'ECONNABORTED') {
          consecutiveFailures++
          if (consecutiveFailures >= cfg.maxConsecutiveFailures) {
            finalResult = { reply: 'AI服务连续超时，请检查网络后重试', steps, mode, error: true }
            break
          }
          continue
        }

        if (error.response?.status === 429) {
          rateLimitCount++
          if (rateLimitCount > 3) {
            finalResult = { reply: 'API 请求频率超限，请稍后再试', steps, mode, error: true }
            break
          }
          const waitTime = Math.min(cfg.rateLimitBaseMs * Math.pow(2, rateLimitCount - 1), cfg.rateLimitMaxMs)
          step.reasoning = `API 限流中，等待 ${Math.round(waitTime / 1000)} 秒后重试 (${rateLimitCount}/3)...`
          this._notifyProgress({ steps, mode, status: 'running' })
          await new Promise(r => setTimeout(r, waitTime))
          continue
        }

        finalResult = { reply: `执行出错: ${error.message}`, steps, mode, error: true }
        break
      }
    }

    if (stepCount >= cfg.maxSteps && !finalResult) {
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

      if (summary.optimizationCount > 0) {
        parts.push(`- 成本优化：已执行 ${summary.optimizationCount} 次优化，可用 optimize_mix_cost 进行成本优化`)
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

    const toolList = this.skillRegistry.skillNames.join('、')

    // 用户自定义技能单独列出，让LLM更显眼地看到
    const userSkills = Array.from(this.skillRegistry._skills.values()).filter(s => !s._builtin)
    let userSkillText = ''
    if (userSkills.length > 0) {
      const skillLines = userSkills.map(s => `  - ${s.name}：${s.description}`).join('\n')
      userSkillText = `\n用户自定义技能（优先使用）：\n${skillLines}\n`
    }

    const modeInstruction = mode === 'auto'
      ? '全自动模式：自主完成所有步骤。每个步骤调用工具前，先用简短文字说明你这一步要做什么、为什么。'
      : '协作模式：每个关键操作执行前需要用户确认。每个步骤调用工具前，先用简短文字说明你这一步要做什么、为什么。'

    return `你是混凝土配合比设计的AI专家助手。可用工具：${toolList}。

${modeInstruction}

${resourceText}
${userSkillText}

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
10. 设计完成后，主动询问用户是否需要规范合规检查（query_compliance_check）
11. 创建技能（create_skill）时，executeCode 参数必须包含完整的业务逻辑代码，不能留 TODO 或占位符。根据用户需求和 context 中可用的服务（materialService、mixDesignService、knowledgeService 等）编写可直接运行的实现。参数定义也要完整填写，不能用空对象
12. 当用户需求匹配已有的自定义技能时，优先调用该技能，不要创建新技能。调用 create_skill 之前，先确认没有功能重复的已有技能
13. 如果用户请求的是"XX配合比设计"且已有对应的自定义技能（如 self_compacting_concrete_design、scc_mix_design 等），直接调用该技能，不要先查材料再手动计算——自定义技能内部会自行获取所需材料数据`
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
    if (!this.wc || this.wc.isDestroyed()) return false

    return new Promise(resolve => {
      let settled = false

      const settle = (val) => {
        if (settled) return
        settled = true
        this._confirmationResolver = null
        resolve(val)
      }

      // 120 秒超时自动拒绝，通知前端
      const timer = setTimeout(() => {
        try { this.wc?.send('agent:confirmation-timeout', { toolName }) } catch (_) {}
        settle(false)
      }, this._agentCfg?.confirmationTimeoutMs || 120000)

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

  /**
   * 构建MD技能的执行指令
   * 委托给 mdInstructionBuilder 纯函数（修复 P0-1 占位符 bug）
   * @param {object} skill - MD技能定义
   * @param {object} args - 用户参数
   * @returns {string} 替换参数后的指令
   */
  _buildMDInstruction(skill, args) {
    return require('./mdInstructionBuilder').buildMDInstruction(skill, args)
  }
}

module.exports = AgentOrchestrator
