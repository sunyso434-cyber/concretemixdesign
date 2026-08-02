'use strict'

// RemoteAgentBridge：远程 Agent 对话桥（R6）。
//
// 把手机 WS 消息转调 M0 共享执行模块（agentExecutor 单例），并构造 base64 图片附件。
// 处理通道：agent:run / agent:pause / agent:resume / agent:abort / agent:confirm + todo:list。
//
// 响应约定（手机端 F3/F4 对齐）：
//   - 处理器在请求的同一通道上回响应：ws.send('<type>', { requestId, success, ... })
//   - agent:run：流式事件（agent:progress 等）经 fanout 扇出到桌面+手机；运行结束回最终结果
//     { success:true, result } 或 { success:false, error }
//   - agent:pause/resume/abort/confirm：即时回 { requestId, success }
//   - todo:list：回 todo-manage skill 的 list 结果
//
// executor 单例：默认经 agentHandler.getExecutor() 取同一实例（不 new，与桌面共享锁/Orchestrator）；
// 测试或未接线场景可用 new RemoteAgentBridge({ executor }) 注入（懒加载 require，注入时不会拉 electron）。

const fs = require('fs')
const path = require('path')

// mimeType 扩展名映射（仅覆盖 imageRefs 允许上传的图片类型）
const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

// 从 agentHandler 取共享 executor 单例（懒加载：注入 executor 时不会触发 require electron）
function resolveSharedExecutor() {
  try {
    const agentHandler = require('../ipcHandlers/agentHandler')
    return typeof agentHandler.getExecutor === 'function' ? agentHandler.getExecutor() : null
  } catch (_) {
    return null
  }
}

// 生成 requestId（与 agentHandler agent:run 同格式）
function genRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// 把 imageRefs（[{ path }] 或字符串路径）读成 base64 attachments（含 mimeType 扩展名映射）。
// 附件必须含 base64 + type:'image'，否则被 UnifiedStrategy filter 丢弃。
// base64 必须带 data:<mime>;base64, 前缀（与桌面端 readAsDataURL 格式一致）——
// 模型要求 http(s):// 或 data: 前缀，裸 base64 会报 "image url must be http(s):// or data:...;base64"。
// 读失败 / 缺 path 的条目跳过，不阻塞主流程。
function buildAttachments(imageRefs) {
  if (!Array.isArray(imageRefs) || imageRefs.length === 0) return []
  const attachments = []
  for (const ref of imageRefs) {
    const filePath = typeof ref === 'string' ? ref : ref && ref.path
    if (!filePath) continue
    try {
      const buf = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeType = EXT_MIME[ext] || 'image/jpeg'
      attachments.push({
        type: 'image',
        base64: `data:${mimeType};base64,${buf.toString('base64')}`,
        mimeType,
        originalName: path.basename(filePath)
      })
    } catch (_) {
      // 读文件失败 → 跳过该图
    }
  }
  return attachments
}

const _logger = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a)
}

class RemoteAgentBridge {
  constructor({ executor } = {}) {
    this._executor = executor || null
  }

  _resolveExecutor() {
    if (this._executor) return this._executor
    return resolveSharedExecutor()
  }

  /**
   * WS 请求处理器（R5 约定签名，RemoteServer 分发：handleMessage(ws, msg, fanout)）。
   * @param {object} ws     请求方目标（wrapWs 包装，具备 send(channel, payload)）
   * @param {object} msg    请求消息 { type: '<通道>', ...payload }
   * @param {object} fanout FanoutSink 实例（作为 agent:run 的 sink，事件扇出给桌面+手机）
   */
  async handleMessage(ws, msg, fanout) {
    const channel = msg && msg.type
    switch (channel) {
      case 'agent:run': return this._handleRun(ws, msg, fanout)
      case 'agent:pause': return this._handleControl(ws, msg, 'agent:pause')
      case 'agent:resume': return this._handleControl(ws, msg, 'agent:resume')
      case 'agent:abort': return this._handleControl(ws, msg, 'agent:abort')
      case 'agent:confirm': return this._handleConfirm(ws, msg)
      case 'todo:list': return this._handleTodoList(ws, msg)
      default:
        // 正常流程不会到这（R5 白名单已过滤）；兜底，不抛错
        ws.send('error', { error: 'CHANNEL_NOT_ALLOWED' })
        return { success: false, error: 'CHANNEL_NOT_ALLOWED' }
    }
  }

  async _handleRun(ws, msg, fanout) {
    const { sessionId, message, mode, requestId, imageRefs } = msg || {}
    const reqId = requestId || genRequestId()
    if (!sessionId) {
      ws.send('agent:run', { requestId: reqId, success: false, error: '缺少 sessionId' })
      return { success: false, error: '缺少 sessionId' }
    }
    if (!message) {
      ws.send('agent:run', { requestId: reqId, success: false, error: '缺少 message' })
      return { success: false, error: '缺少 message' }
    }
    const executor = this._resolveExecutor()
    if (!executor) {
      ws.send('agent:run', { requestId: reqId, success: false, error: 'EXECUTOR_NOT_READY' })
      return { success: false, error: 'EXECUTOR_NOT_READY' }
    }
    const attachments = buildAttachments(imageRefs)
    const result = await executor.runAgentSession({
      sessionId,
      requestId: reqId,
      message,
      mode,
      attachments,
      sink: fanout,
      persistUserMessage: true
    })
    ws.send('agent:run', { requestId: reqId, ...result })
    return result
  }

  async _handleControl(ws, msg, channel) {
    const { sessionId, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    const executor = this._resolveExecutor()
    if (!executor) {
      ws.send(channel, { requestId: reqId, success: false, error: 'EXECUTOR_NOT_READY' })
      return { success: false, error: 'EXECUTOR_NOT_READY' }
    }
    const action = channel.replace('agent:', '')
    if (typeof executor[action] !== 'function') {
      ws.send(channel, { requestId: reqId, success: false, error: `executor 缺少 ${action} 方法` })
      return { success: false, error: `executor 缺少 ${action} 方法` }
    }
    const result = executor[action]({ sessionId })
    ws.send(channel, { requestId: reqId, ...result })
    return result
  }

  async _handleConfirm(ws, msg) {
    const { sessionId, confirmed, args, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    const executor = this._resolveExecutor()
    if (!executor) {
      ws.send('agent:confirm', { requestId: reqId, success: false, error: 'EXECUTOR_NOT_READY' })
      return { success: false, error: 'EXECUTOR_NOT_READY' }
    }
    const result = executor.confirm({ sessionId, confirmed, args })
    ws.send('agent:confirm', { requestId: reqId, ...result })
    return result
  }

  async _handleTodoList(ws, msg) {
    const { sessionId, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!sessionId) {
      const err = { success: false, error: '缺少 sessionId', todos: [], total: 0, completed: 0 }
      ws.send('todo:list', { requestId: reqId, ...err })
      return err
    }
    try {
      // 复用 todo-manage skill 的 list action（与 agentHandler.js todo:list 相同逻辑）
      const todoManage = require('../skills/todo-manage')
      const result = await todoManage.execute({ action: 'list' }, { sessionId, logger: _logger })
      ws.send('todo:list', { requestId: reqId, ...result })
      return result
    } catch (e) {
      const err = { success: false, error: e.message, todos: [], total: 0, completed: 0 }
      ws.send('todo:list', { requestId: reqId, ...err })
      return err
    }
  }
}

module.exports = RemoteAgentBridge
