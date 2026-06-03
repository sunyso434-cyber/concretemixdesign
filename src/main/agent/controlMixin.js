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
 * 中止执行：把 aborted 标志置为 true，调用方应在主循环中检查。
 */
function abort() {
  this.aborted = true
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

module.exports = {
  _notifyProgress,
  pause,
  resume,
  abort,
  _cleanMessage
}
