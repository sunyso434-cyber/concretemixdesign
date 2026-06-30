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
    this._pendingConfirmation = { resolve, reject, payload }
    // 发事件给前端，前端 DecisionGate 弹窗
    if (this.webContents && !this.webContents.isDestroyed?.()) {
      try {
        this.webContents.send('agent:confirmation-request', {
          sessionId: this.sessionId,
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

module.exports = {
  _notifyProgress,
  pause,
  resume,
  abort,
  _cleanMessage,
  requestConfirmation,
  resolveConfirmation
}
