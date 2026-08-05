/**
 * 共享控制逻辑 mixin
 *
 * 从 UnifiedOrchestrator / AgentOrchestrator 抽离的：
 * - _notifyProgress：通过 webContents 推送进度（前端订阅）
 * - pause / resume / abort：状态机控制
 * - _cleanMessage：清理消息（保留 reasoning_content）
 *
 * 解决 P1-1：errorHandler payload 加 errorSource 字段
 *
 * 使用方式：
 *   const controlMixin = require('./controlMixin')
 *   class MyOrchestrator {
 *     constructor(webContents) {
 *       this.webContents = webContents
 *       this.state = 'idle'
 *       this.aborted = false
 *       Object.assign(this, controlMixin)
 *     }
 *   }
 */

/**
 * 向渲染进程发送进度事件。
 *
 * 静默条件：
 * 1. webContents 不存在（如 CLI 场景）
 * 2. webContents 已销毁（窗口关闭）
 * 3. send 抛错 → 走 errorHandler.warn 记录（P1-1 引入）
 *
 * @param {string} event 事件名（如 'agent:progress'）
 * @param {object} payload 事件载荷
 */
function _notifyProgress(event, payload) {
  if (this.webContents && !this.webContents.isDestroyed?.()) {
    try {
      this.webContents.send(event, payload)
    } catch (e) {
      // P1-1: 静默走 errorHandler.warn 而非 catch(()=>{})
      // 嵌套 try/catch：D1 之前 errorHandler 还不存在，require 失败时彻底静默
      try {
        require('./../utils/errorHandler').warn('ui_notify_failed', { event, error: e.message })
      } catch (_) { /* errorHandler 尚未创建（D1 之前），彻底静默 */ }
    }
  }
}

/**
 * 暂停执行：仅当 state === 'running' 时切换到 'paused'。
 * 真实编排器可以在 _runLoop 中监听 this.state === 'paused' 进入等待。
 */
function pause() {
  if (this.state === 'running') {
    this.state = 'paused'
  }
}

/**
 * 恢复执行：仅当 state === 'paused' 时切换回 'running'。
 */
function resume() {
  if (this.state === 'paused') {
    this.state = 'running'
  }
}

/**
 * 中止执行：把 aborted 标志置为 true，同时触发 AbortController（若有）。
 * 调用方应在主循环中检查 signal.aborted 或 this.aborted。
 */
function abort() {
  this.aborted = true
  this._abortController?.abort()
}

/**
 * 清理消息对象，剥离非可序列化字段。
 * 保留字段：role / content / tool_call_id / name / tool_calls / reasoning_content
 *
 * 设计要点：
 * - 保留 reasoning_content 以便 deepseek-reasoner 等模型保留思考链
 * - tool_calls 仅保留 id/type/function.{name,arguments}，不携带运行时引用
 *
 * @param {object} msg 原始消息
 * @returns {object} 清理后的消息
 */
function _cleanMessage(msg) {
  const cleaned = {
    role: msg.role,
    content: msg.content
  }
  if (msg.reasoning_content) {
    cleaned.reasoning_content = msg.reasoning_content
  }
  if (msg.tool_call_id) {
    cleaned.tool_call_id = msg.tool_call_id
  }
  if (msg.name) {
    cleaned.name = msg.name
  }
  if (msg.tool_calls) {
    cleaned.tool_calls = msg.tool_calls
  }
  return cleaned
}

/**
 * v9.1.0 ask_user：向用户发起确认请求（跨进程等待用户回答）
 *
 * 流程：
 * 1. skill（如 ask_user）调 context.orchestrator.requestConfirmation({ question, inputType, ... })
 * 2. 本方法把请求存到 this._pendingConfirmation（Promise），通过 webContents 发 agent:confirmation-request 事件
 * 3. 前端 DecisionGate 收到事件弹窗，用户回答后调 IPC agent:confirm
 * 4. agentHandler.js 的 agent:confirm handler 调 orchestrator.resolveConfirmation(confirmed, args)
 * 5. 本方法 resolve/reject 上面那个 Promise，skill 拿到结果继续执行
 *
 * 超时：90s（必须 < AGENT_LOCK_TIMEOUT 120s，避免会话锁先释放）
 *
 * @param {object} payload - 请求载荷
 * @param {string} payload.question - 要问用户的问题
 * @param {string} [payload.inputType='text'] - 'text' 自由文本 / 'choice' 选项
 * @param {string[]} [payload.options] - inputType='choice' 时的选项
 * @param {string} [payload.placeholder] - inputType='text' 时的输入框占位
 * @param {string} [payload.defaultValue] - 用户跳过时的默认值
 * @param {string} [payload.toolName] - 工具名（用于前端显示）
 * @returns {Promise<object>} resolve 为 { answer } 或 reject 为 Error('USER_REJECTED'/'USER_CONFIRMATION_TIMEOUT')
 */
function requestConfirmation(payload) {
  if (this._pendingConfirmation) {
    return Promise.reject(new Error('已有进行中的确认请求，不支持嵌套'))
  }
  return new Promise((resolve, reject) => {
    // v2026-08-03：confirmationId 用于两个目的：
    //   1) resolveConfirmation 校验回答归属（旧弹窗残留回答不污染新提问）
    //   2) 超时后发 agent:confirmation-close 让前端按 ID 收起（避免弹窗残留卡住后续提问）
    const confirmationId = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this._pendingConfirmation = { resolve, reject, payload, confirmationId }
    // 发事件给前端，前端 DecisionGate 弹窗
    if (this.webContents && !this.webContents.isDestroyed?.()) {
      try {
        this.webContents.send('agent:confirmation-request', {
          sessionId: this.sessionId,
          confirmationId,
          ...payload
        })
      } catch (e) {
        // webContents 发送失败 → 立即 reject，避免永久等待
        this._pendingConfirmation = null
        reject(new Error('WEB_CONTENTS_SEND_FAILED'))
        return
      }
    } else {
      // 无 webContents（CLI 场景或窗口已关闭）→ 立即 reject
      this._pendingConfirmation = null
      reject(new Error('NO_WEB_CONTENTS'))
      return
    }
    // 90s 超时（< AGENT_LOCK_TIMEOUT 120s）
    this._confirmationTimer = setTimeout(() => {
      if (this._pendingConfirmation) {
        const p = this._pendingConfirmation
        this._pendingConfirmation = null
        // v2026-08-03：超时后通知前端收起弹窗（否则弹窗残留 → 挡住/卡住后续提问）
        try {
          if (this.webContents && !this.webContents.isDestroyed?.()) {
            this.webContents.send('agent:confirmation-close', {
              sessionId: this.sessionId,
              confirmationId: p.confirmationId
            })
          }
        } catch (_) { /* 前端收不到也不影响超时收尾 */ }
        p.reject(new Error('USER_CONFIRMATION_TIMEOUT'))
      }
    }, 90 * 1000)
  })
}

/**
 * v9.1.0 ask_user：用户回答后由 agentHandler.agent:confirm IPC 调用，resolve 上面的 Promise
 *
 * @param {boolean} confirmed - true=用户确认/回答，false=用户取消
 * @param {object} [args] - 用户回答的内容（如 { answer: 'xxx' }）
 */
function resolveConfirmation(confirmed, args) {
  if (!this._pendingConfirmation) {
    // 无 pending 请求（可能是过时事件或重复调用），静默返回
    return
  }
  // v2026-08-03：校验 confirmationId 归属——旧弹窗残留的回答（已超时/已被新提问替换）
  // 不得 resolve 当前 pending；不带 id 的旧调用方（如存量测试/旧前端）保持放行
  const reqId = args && args.confirmationId
  if (reqId && this._pendingConfirmation.confirmationId && reqId !== this._pendingConfirmation.confirmationId) {
    return
  }
  clearTimeout(this._confirmationTimer)
  this._confirmationTimer = null
  const { resolve, reject } = this._pendingConfirmation
  this._pendingConfirmation = null
  if (confirmed) {
    resolve(args || {})
  } else {
    reject(new Error('USER_REJECTED'))
  }
}

/**
 * 批 B N3 插话：steer 入队（Agent 执行中插入新指令，下一轮 LLM 看到）
 *
 * 设计：懒初始化（不依赖 orchestrator 构造函数预声明），队列是实例属性。
 * drain 取出全部并清空，返回数组（无内容返回 []）。
 * steering 优先于 followUp（同时存在时由调用方先 drain steering，见 Task 1.8）。
 *
 * @param {string} msg - 插话/追加指令内容
 */
function steer(msg) {
  if (!msg) return
  if (!Array.isArray(this.steeringQueue)) this.steeringQueue = []
  this.steeringQueue.push(msg)
}

function followUp(msg) {
  if (!msg) return
  if (!Array.isArray(this.followUpQueue)) this.followUpQueue = []
  this.followUpQueue.push(msg)
}

/**
 * 取出全部 steering 并清空队列（Task 1.8 每轮 LLM 调用前调用）
 * @returns {string[]} 累积的插话消息数组（可能为空）
 */
function drainSteering() {
  if (!Array.isArray(this.steeringQueue) || this.steeringQueue.length === 0) return []
  const out = this.steeringQueue.slice()
  this.steeringQueue = []
  return out
}

/**
 * 取出全部 followUp 并清空队列（Task 1.8 任务完成后调用，续跑新任务）
 * @returns {string[]} 累积的追加任务消息数组（可能为空）
 */
function drainFollowUp() {
  if (!Array.isArray(this.followUpQueue) || this.followUpQueue.length === 0) return []
  const out = this.followUpQueue.slice()
  this.followUpQueue = []
  return out
}

/**
 * 中断标志机制（Task 1: controlMixin 中断机制，Enter 排队插话 + Alt+Enter 立即插话基础原语）
 *
 * 设计：
 * - requestInterrupt：置 interruptRequested=true，同时 abort 本轮 AbortController（_currentTurnAbort，由 Task 10 UnifiedStrategy 注入）
 * - clearInterrupt / isInterrupted：标志的读写
 * - cancelPendingConfirmation：插话时若有待确认弹窗（ask_user），主动清掉并 reject（否则弹窗卡住插话流程）
 *
 * 与既有 abort()（整任务中止）的区别：interrupt 是「插话」级别的软中断，只中断当前这一轮，
 * 由调用方在下一轮/任务收尾时检查并 clearInterrupt。
 */
function requestInterrupt() {
  this.interruptRequested = true
  try { this._currentTurnAbort?.abort() } catch (_) {}
}

function clearInterrupt() {
  this.interruptRequested = false
}

function isInterrupted() {
  return !!this.interruptRequested
}

/**
 * 插话时取消挂起的确认弹窗（ask_user）：
 * 清 timer、发 agent:confirmation-close 让前端收起弹窗、reject 原 Promise（INTERRUPTED_BY_STEER）。
 * 无 pending 时静默（幂等）。
 */
function cancelPendingConfirmation() {
  if (this._pendingConfirmation) {
    const p = this._pendingConfirmation
    this._pendingConfirmation = null
    if (this._confirmationTimer) {
      clearTimeout(this._confirmationTimer)
      this._confirmationTimer = null
    }
    try { this.webContents?.send?.('agent:confirmation-close', { sessionId: this.sessionId, confirmationId: p.confirmationId }) } catch (_) {}
    p.reject(new Error('INTERRUPTED_BY_STEER'))
  }
}

module.exports = {
  _notifyProgress,
  pause,
  resume,
  abort,
  _cleanMessage,
  requestConfirmation,
  resolveConfirmation,
  steer,
  followUp,
  drainSteering,
  drainFollowUp,
  requestInterrupt,
  clearInterrupt,
  isInterrupted,
  cancelPendingConfirmation
}
