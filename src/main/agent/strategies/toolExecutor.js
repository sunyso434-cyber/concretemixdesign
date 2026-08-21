// UnifiedStrategy 工具执行方法集（从 UnifiedStrategy.js 拆分，优化项 2，行为不变）
// 这些函数作为原型方法挂回 UnifiedStrategy 类（主文件 Object.assign），
// 通过 this 访问 skillRegistry/skillExecutor/toolResultStore/sessionId/orchestrator/webContents 等实例属性。
// 错误升级阈值常量定义于此（execute 主流程与工具执行共用，由主文件导入）。
const { buildMDInstruction } = require('../mdInstructionBuilder')
const errorHandler = require('../../utils/errorHandler')
const { classifyError } = require('../errorClassifier')
const eventBus = require('../EventBus')

// v8.2.5: 软提醒阈值（连续失败 N 次注入换路提示，仅触发 1 次）
const SOFT_WARN_THRESHOLD = 3
// v8.2.3/v8.2.5: 硬熔断阈值（skillExec 连续失败 N 次 → fatal）
const HARD_FUSE_THRESHOLD = 6
// v8.2.5: 网络错误熔断阈值（llmNetwork）
const LLN_NETWORK_FUSE = 5

  /**
   * 工具消息统一构造：微压缩落盘（offloaded）→ 推 _cached 摘要引用；否则推原始内容
   * @returns {object} 可直接 push 到 trimmedMessages 的 tool 消息
   */
  function _buildCachedToolMsg(toolCallId, rawContent, cacheResult) {
    if (cacheResult && cacheResult.offloaded) {
      return {
        role: 'tool',
        content: JSON.stringify({
          _cached: true,
          path: cacheResult.path,
          summary: cacheResult.summary,
          tool_call_id: toolCallId
        }),
        tool_call_id: toolCallId
      }
    }
    return { role: 'tool', content: rawContent, tool_call_id: toolCallId }
  }

  /**
   * 按工具结果描述符发完成事件（tool_done / tool_error）
   * - kind='md'/'ok' → tool_done
   * - kind='fail'/'missing' → tool_error
   * - kind='interrupted' → 不发（被插话打断不报错，与旧行为一致）
   * - kind='fatal' → 不发（由 _executeToolCalls 统一发 type:'error'）
   */
  function _emitToolCompletion(r, { mode, roundIndex }) {
    const { tc, name, args, kind, execResult, errorMsg } = r
    if (kind === 'md') {
      this._notifyProgress(this.webContents, {
        type: 'tool_done', toolCallId: tc.id, toolName: name, args,
        result: { _mdInstruction: true }, roundIndex, mode, status: 'running'
      })
    } else if (kind === 'ok') {
      this._notifyProgress(this.webContents, {
        type: 'tool_done', toolCallId: tc.id, toolName: name, args,
        result: execResult, roundIndex, mode, status: 'running'
      })
    } else if (kind === 'fail') {
      this._notifyProgress(this.webContents, {
        type: 'tool_error', toolCallId: tc.id, toolName: name, args,
        error: errorMsg, roundIndex, mode, status: 'running'
      })
    } else if (kind === 'missing') {
      this._notifyProgress(this.webContents, {
        type: 'tool_error', toolCallId: tc.id, toolName: name, args,
        error: errorMsg, roundIndex, mode, status: 'running'
      })
    }
  }

  /**
   * 插话/中断检查（Task 6/10/11 机制，从旧串行循环抽出）
   * 有插话 → 给未执行的 tool_calls 补合成（双写）+ 注入插话 user 消息（双写）
   * 中断 ≠ 终止：只 break 出工具执行，绝不 return（下一轮 LLM 看到完整序列后继续）
   * @param {function|null} mergeExecutedResults 命中插话/中断时，先把已执行工具结果按原始全序列顺序
   *   合并进 trimmedMessages，再补合成剩余——保证「真实结果在前、合成在后」（审查 Finding 1 修复）
   * @returns {boolean} true = 应 break 出工具执行（继续下一轮 LLM）
   */
  async function _checkSteerInterrupt(toolCalls, executedIds, trimmedMessages, mode, mergeExecutedResults) {
    const sessionId = this.sessionId
    // drain steering（Enter 工具边界插话）
    const _steerMid = this.orchestrator?.drainSteering ? this.orchestrator.drainSteering() : []
    if (_steerMid.length > 0) {
      if (mergeExecutedResults) mergeExecutedResults()
      const synthMsgs = await this.agentMemoryService.synthToolResults(sessionId, toolCalls, executedIds, 'steer')
      for (const sm of synthMsgs) { trimmedMessages.push(sm) }
      const _c = _steerMid.join('\n')
      trimmedMessages.push({ role: 'user', content: _c })
      try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { steer: true } }) } catch (_) {}
      this._notifyProgress(this.webContents, { type: 'steer_injected', content: _c, mode, source: 'tool_boundary' })
      return true
    }
    // 检查 interruptRequested（Alt+Enter 立即插话，Task 10 使该标志生效）
    if (this.orchestrator?.isInterrupted?.()) {
      if (mergeExecutedResults) mergeExecutedResults()
      const synthMsgs = await this.agentMemoryService.synthToolResults(sessionId, toolCalls, executedIds, 'interrupt')
      for (const sm of synthMsgs) { trimmedMessages.push(sm) }
      const _immSteer = this.orchestrator?.drainSteering ? this.orchestrator.drainSteering() : []
      if (_immSteer.length > 0) {
        const _c = _immSteer.join('\n')
        trimmedMessages.push({ role: 'user', content: _c })
        try { await this.agentMemoryService.saveMessage({ sessionId, role: 'user', content: _c, metadata: { steer: true, immediate: true } }) } catch (_) {}
        this._notifyProgress(this.webContents, { type: 'steer_injected', content: _c, mode, source: 'immediate' })
      }
      this.orchestrator?.clearInterrupt?.()
      return true
    }
    return false
  }

  /**
   * 执行单个工具（逻辑从旧 for 循环内联体抽取）
   * - 不发事件（tool_start/done/error 由 _executeToolCalls 按顺序统一发送）
   * - 不 push toolMsg 到 trimmedMessages（返回 toolMsg，由调用方按原始顺序合并）
   * - 不记录 executedIds（由调用方统一记录）
   * @returns {object} 描述符 { tc, name, args, kind, toolMsg, ... }
   *   kind: 'md' | 'ok' | 'fail' | 'interrupted' | 'missing' | 'fatal'
   */
  async function _executeSingleTool(tc, ctx) {
    const { trimmedMessages, failureCounters, softWarnSent } = ctx
    const sessionId = this.sessionId
    const { name, arguments: argsStr } = tc.function
    let args = {}
    try { args = JSON.parse(argsStr) } catch (_) { args = {} }

    const skill = this.skillRegistry.getSkill(name)

    // MD skill：直接注入指令文本作为 tool 结果
    if (skill && skill._isMDSkill) {
      const mdInstruction = buildMDInstruction(skill, args)
      const toolMsg = { role: 'tool', tool_call_id: tc.id, content: mdInstruction }
      try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: mdInstruction, toolCallId: tc.id }) } catch (_) {}
      return { tc, name, args, kind: 'md', toolMsg }
    }

    if (skill) {
      let execResult
      try {
        // v9.1.0: 传 runtimeCtx（含 sessionId/orchestrator/webContents）给 SkillExecutor
        // - todo_manage 用 sessionId 隔离会话清单
        // - ask_user 用 orchestrator/webContents 跨进程等待用户回答
        // v0.6.0 Task 1.12：传 toolCallId（tc.id）给写操作 skill 作幂等键
        execResult = await this.skillExecutor.execute(name, args, {
          sessionId,
          orchestrator: this.orchestrator,
          webContents: this.webContents,
          toolCallId: tc.id
        })
      } catch (execErr) {
        execResult = { success: false, error: execErr.message }
      }

      if (execResult && execResult.success === false) {
        // v3.0 问题 D：被 steer 打断的 ask_user 返回 INTERRUPTED_BY_STEER（interrupted:true）→
        // 视为正常中断，不是"失败"——跳过 recordFailure + skillExec++ + 软提醒 + 熔断，
        // 否则连续打断会把 skillExec 顶到 HARD_FUSE_THRESHOLD 误熔断。
        const isInterrupted = execResult.error === 'INTERRUPTED_BY_STEER' || execResult.interrupted === true

        // === 跳过区（v3.1 要点 1）：只包「记账 + 软提醒 + 熔断」，中断时不执行 ===
        if (!isInterrupted) {
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

          // v8.2.5: 软提醒 — 连续失败 3 次后向 LLM 注入"换路"提示（仅触发 1 次）
          if (failureCounters.skillExec === SOFT_WARN_THRESHOLD && !softWarnSent.skillExec) {
            const warnMsg = `⚠️ 你已在这条路径上连续失败 3 次（工具 "${name}" 执行失败）。请停下分析：失败原因是什么？换一种工具 / 换一套参数 / 换条路径，而不是重试同样的方法。`
            trimmedMessages.push({ role: 'user', content: warnMsg })
            softWarnSent.skillExec = true
          }

          // 硬熔断：用 === 保证并发下恰好一个工具触发 fatal
          // （JS 单线程，skillExec 每次 +1，命中 === 的即把计数推到阈值的那一个）
          if (failureCounters.skillExec === HARD_FUSE_THRESHOLD) {
            errorHandler.fatal('orchestrator', { counters: failureCounters })
            // Task 2: 微压缩（带 try-catch，磁盘 I/O 失败不阻塞主流程）
            let cacheResultFatal = null
            try { cacheResultFatal = this.toolResultStore.store(sessionId, tc.id, execResult) } catch (_) {}
            const toolErrContent1 = JSON.stringify(execResult)
            const toolMsg = this._buildCachedToolMsg(tc.id, toolErrContent1, cacheResultFatal)
            try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolErrContent1, toolCallId: tc.id }) } catch (_) {}
            const finalResult = { reply: `执行"${name}"时连续失败：${errorMsg}`, mode: ctx.mode, error: true }
            const classifiedError = classifyError(new Error('max_failures_exceeded: skill execution failures exceeded threshold'), {
              callSite: 'UnifiedStrategy.skillExec',
              sessionId,
            })
            return { tc, name, args, kind: 'fatal', execResult, errorMsg, toolMsg, finalResult, classifiedError }
          }

          // 非 fatal 失败：微压缩（带 try-catch）
          const failResult = { ...execResult, hint: '此步骤执行失败，请尝试其他方法或跳过' }
          let cacheResultFail = null
          try { cacheResultFail = this.toolResultStore.store(sessionId, tc.id, failResult) } catch (_) {}
          const toolContentFail = JSON.stringify(failResult)
          const toolMsg = this._buildCachedToolMsg(tc.id, toolContentFail, cacheResultFail)
          try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: JSON.stringify(execResult), toolCallId: tc.id }) } catch (_) {}
          return { tc, name, args, kind: 'fail', execResult, errorMsg, toolMsg }
        }

        // === 非跳过区（v3.1 要点 1）：中断类结果也要落库 tool 消息（LLM 看到 ask_user 被插话打断）===
        // 合成内容改友好，避免 LLM 不理解英文错误码
        const toolContentForLlm = JSON.stringify({ interrupted: true, note: '用户已插话，请直接处理插话消息' })
        let cacheResultInt = null
        try { cacheResultInt = this.toolResultStore.store(sessionId, tc.id, JSON.parse(toolContentForLlm)) } catch (_) {}
        const toolMsgInt = this._buildCachedToolMsg(tc.id, toolContentForLlm, cacheResultInt)
        try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolContentForLlm, toolCallId: tc.id }) } catch (_) {}
        return { tc, name, args, kind: 'interrupted', toolMsg: toolMsgInt }
      }

      // 成功
      failureCounters.skillExec = 0
      // v8.2.5: 工具成功 → 计数器清零 → 同步重置软提醒标志
      softWarnSent.skillExec = false
      // P1：通知 LearningService 工具执行成功，用于偏好学习
      // LearningService._onToolExecuted 已过滤 result.success===false 和非 calculate_mix_design 工具
      try { eventBus.emitToolExecuted(name, args, execResult) } catch (_) {}
      // Task 2: 微压缩 — 大工具结果落盘（带 try-catch）
      let cacheResultOk = null
      try { cacheResultOk = this.toolResultStore.store(sessionId, tc.id, execResult) } catch (_) {}
      const toolContentOk = JSON.stringify(execResult)
      const toolMsgOk = this._buildCachedToolMsg(tc.id, toolContentOk, cacheResultOk)
      try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolContentOk, toolCallId: tc.id }) } catch (_) {}
      return { tc, name, args, kind: 'ok', execResult, toolMsg: toolMsgOk }
    }

    // 工具不存在：微压缩（带 try-catch）
    const missingResult = { success: false, error: `工具 ${name} 不存在` }
    let cacheResultMiss = null
    try { cacheResultMiss = this.toolResultStore.store(sessionId, tc.id, missingResult) } catch (_) {}
    const toolContentMissing = JSON.stringify(missingResult)
    const toolMsgMiss = this._buildCachedToolMsg(tc.id, toolContentMissing, cacheResultMiss)
    try { await this.agentMemoryService.saveMessage({ sessionId, role: 'tool', content: toolContentMissing, toolCallId: tc.id }) } catch (_) {}
    return { tc, name, args, kind: 'missing', errorMsg: `工具 ${name} 不存在`, toolMsg: toolMsgMiss }
  }

  /**
   * Task 2.3 核心：读写分组并发执行工具
   * - READ 工具（skill.isWrite !== true）并发执行（Promise.all）
   * - WRITE 工具（skill.isWrite === true）串行执行（for loop）
   * - 事件顺序对齐：并发批次先按请求顺序发 tool_start，完成后再按请求顺序发 tool_done
   * - 结果按原始 tool_call_id 顺序合并回 trimmedMessages
   * - 插话/中断：读批次边界检查一次；每个写工具后检查（与旧串行循环语义一致）
   * @returns {null} 正常结束 / break（继续下一轮 LLM）
   * @returns {{success:false,error:object}} fatal 硬熔断 → execute 直接返回
   */
  async function _executeToolCalls(response, { trimmedMessages, failureCounters, softWarnSent, mode, roundIndex }) {
    const toolCalls = response.tool_calls
    const ctx = { trimmedMessages, failureCounters, softWarnSent, mode, roundIndex }

    // 1. 按读写分组（组内保持请求原始顺序；skill 无 isWrite（undefined）视为读）
    const reads = []
    const writes = []
    for (const tc of toolCalls) {
      const skill = this.skillRegistry.getSkill(tc.function.name)
      if (skill && skill.isWrite === true) writes.push(tc)
      else reads.push(tc)
    }

    const executedIds = new Set()
    // 结果描述符按 tc.id 收集，最终按原始 tool_calls 全序列顺序合并
    // （审查 Finding 1 修复：交错读写时必须保持"全序列"原序，而非读组整体在前、写组整体在后）
    const resultsById = new Map()
    const mergeExecutedResults = () => {
      for (const tc of toolCalls) {
        const r = resultsById.get(tc.id)
        if (r) trimmedMessages.push(r.toolMsg)
      }
    }

    // 2. 读批次：并发前按请求顺序发 tool_start（前端按请求序展示"开始执行"卡片）
    for (const tc of reads) {
      const { name, arguments: argsStr } = tc.function
      let args = {}
      try { args = JSON.parse(argsStr) } catch (_) { args = {} }
      this._notifyProgress(this.webContents, {
        type: 'tool_start', toolCallId: tc.id, toolName: name, args,
        roundIndex, mode, status: 'running'
      })
    }

    // 3. 读批次并发执行（读无副作用，执行无害）
    const readResults = await Promise.all(reads.map(tc => this._executeSingleTool(tc, ctx)))

    // 4. 收集结果 + 发完成事件 + 记录 executedIds（完成事件按读组请求序）
    for (let i = 0; i < reads.length; i++) {
      const r = readResults[i]
      resultsById.set(reads[i].id, r)
      this._emitToolCompletion(r, { mode, roundIndex })
      executedIds.add(reads[i].id)
    }

    // 5. fatal 检查（任一读工具触发熔断 → 终止 execute）
    const fatalRead = readResults.find(r => r.kind === 'fatal')
    if (fatalRead) {
      mergeExecutedResults()
      this._notifyProgress(this.webContents, { type: 'error', error: fatalRead.classifiedError, result: fatalRead.finalResult, mode })
      return { success: false, error: fatalRead.classifiedError }
    }

    // 6. 读批次边界：steer / interrupt 检查一次（并发执行中无法逐工具检查）
    //    审查 Finding 2 修复：仅当读批非空才在此检查——"批次内至少一个工具已执行"之后。
    //    全写批次跳此步，保证第一个写工具先执行（否则整批被合成 = 用户可见的写行为变化）
    if (reads.length > 0) {
      const breakAfterReads = await this._checkSteerInterrupt(toolCalls, executedIds, trimmedMessages, mode, mergeExecutedResults)
      if (breakAfterReads) return null
    }

    // 7. 写批次串行执行（先执行第一个写工具，再逐写检查 steer/interrupt，语义同旧串行循环）
    for (const tc of writes) {
      const { name, arguments: argsStr } = tc.function
      let args = {}
      try { args = JSON.parse(argsStr) } catch (_) { args = {} }
      this._notifyProgress(this.webContents, {
        type: 'tool_start', toolCallId: tc.id, toolName: name, args,
        roundIndex, mode, status: 'running'
      })

      const r = await this._executeSingleTool(tc, ctx)
      resultsById.set(tc.id, r)
      this._emitToolCompletion(r, { mode, roundIndex })
      executedIds.add(tc.id)

      if (r.kind === 'fatal') {
        mergeExecutedResults()
        this._notifyProgress(this.webContents, { type: 'error', error: r.classifiedError, result: r.finalResult, mode })
        return { success: false, error: r.classifiedError }
      }

      const breakAfterWrite = await this._checkSteerInterrupt(toolCalls, executedIds, trimmedMessages, mode, mergeExecutedResults)
      if (breakAfterWrite) return null
    }

    // 8. 全部执行完：按原始 tool_calls 全序列顺序合并（此时才真正写入 trimmedMessages）
    mergeExecutedResults()
    return null
  }

module.exports = { _buildCachedToolMsg, _emitToolCompletion, _checkSteerInterrupt, _executeSingleTool, _executeToolCalls, SOFT_WARN_THRESHOLD, HARD_FUSE_THRESHOLD, LLN_NETWORK_FUSE }