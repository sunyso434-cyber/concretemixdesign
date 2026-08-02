'use strict'

// RemoteWorkspaceApi：远程工作区管理（R8）。
//
// 处理通道（与 RemoteServer ROUTE_TABLE 的 workspace 键对齐）：
//   - workspace:listRecent → 最近 N 个工作区（lastWorkspaceStore.listRecent），标注当前项 isCurrent
//   - workspace:open       → 切工作区（workspaceManager.open），成功后
//                            fanout 广播 workspace:changed（桌面+手机双向刷新）+ 更新 lastWorkspaceStore
//   - workspace:current    → 当前工作区 path
//
// 响应约定（R6 一致）：请求的同一通道回 { requestId, success, ...payload }；
// requestId 缺省时生成（与 agentHandler agent:run 同格式 req_<ts>_<rand>）。
//
// workspaceManager 依赖：构造时 { workspaceManager } 注入（与 RemoteAgentBridge 同款）；
// 未注入时懒加载 global.workspaceManager（main.js 启动时设置，与 RemoteSessionApi 读
// global.chatHistorySync 同款）；两者皆无时 open 回 WORKSPACE_MANAGER_NOT_AVAILABLE。
// 纯 Node，不 require electron。

// 生成 requestId（与 agentHandler agent:run 同格式）
function genRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

class RemoteWorkspaceApi {
  constructor({ workspaceManager } = {}) {
    this._workspaceManager = workspaceManager || null
  }

  _resolveWorkspaceManager() {
    if (this._workspaceManager) return this._workspaceManager
    return global.workspaceManager || null
  }

  /**
   * WS 请求处理器（R5 约定签名，RemoteServer 分发：handleMessage(ws, msg, fanout)）。
   * @param {object} ws     请求方目标（wrapWs 包装，具备 send(channel, payload)）
   * @param {object} msg    请求消息 { type: '<通道>', ...payload }
   * @param {object} fanout FanoutSink 实例（open 成功后广播 workspace:changed 通知桌面+手机）
   */
  async handleMessage(ws, msg, fanout) {
    const channel = msg && msg.type
    switch (channel) {
      case 'workspace:listRecent': return this._handleListRecent(ws, msg)
      case 'workspace:open': return this._handleOpen(ws, msg, fanout)
      case 'workspace:current': return this._handleCurrent(ws, msg)
      default:
        // 正常流程不会到这（R5 白名单已过滤）；兜底，不抛错
        ws.send('error', { error: 'CHANNEL_NOT_ALLOWED' })
        return { success: false, error: 'CHANNEL_NOT_ALLOWED' }
    }
  }

  /**
   * workspace:listRecent — 最近 N 个工作区，标注当前工作区 isCurrent。
   * 复用 lastWorkspaceStore.listRecent（新在前，N=20 由 store 截断）。
   */
  async _handleListRecent(ws, msg) {
    const { requestId } = msg || {}
    const reqId = requestId || genRequestId()
    try {
      const lastWorkspaceStore = require('../workspace/lastWorkspaceStore')
      const wm = this._resolveWorkspaceManager()
      const currentPath = wm && typeof wm.current === 'function' ? (wm.current()?.path || null) : null
      const recent = lastWorkspaceStore.listRecent().map(e => ({
        path: e.path,
        savedAt: e.savedAt,
        isCurrent: !!currentPath && e.path === currentPath
      }))
      const resp = { requestId: reqId, success: true, recent }
      ws.send('workspace:listRecent', resp)
      return resp
    } catch (err) {
      ws.send('workspace:listRecent', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * workspace:open — 切工作区。
   * 成功后：fanout 广播 workspace:changed（桌面组件监听刷新当前工作区显示）
   * + 更新 lastWorkspaceStore（set 幂等去重，重复 open 仅置顶刷新 savedAt）。
   * 注意：WorkspaceManager.open 内部已写一次 store（规范化路径），此处用 current() 的
   * 规范化路径再 set 一次，确保与广播的 path 完全一致。
   */
  async _handleOpen(ws, msg, fanout) {
    const { path: p, requestId } = msg || {}
    const reqId = requestId || genRequestId()
    if (!p || typeof p !== 'string') {
      ws.send('workspace:open', { requestId: reqId, success: false, error: '缺少 path' })
      return { success: false, error: '缺少 path' }
    }
    const wm = this._resolveWorkspaceManager()
    if (!wm || typeof wm.open !== 'function') {
      ws.send('workspace:open', { requestId: reqId, success: false, error: 'WORKSPACE_MANAGER_NOT_AVAILABLE' })
      return { success: false, error: 'WORKSPACE_MANAGER_NOT_AVAILABLE' }
    }
    try {
      await wm.open(p)
      // 统一用当前规范化路径（WorkspaceManager.open 内部会把反斜杠转正斜杠）
      const normalized = (wm.current && wm.current()?.path) || p
      // 广播到桌面+手机（桌面组件监听 workspace:changed 刷新当前工作区显示）
      if (fanout && typeof fanout.send === 'function') {
        try { fanout.send('workspace:changed', { path: normalized }) } catch (_) {}
      }
      // 更新最近列表
      try {
        const lastWorkspaceStore = require('../workspace/lastWorkspaceStore')
        lastWorkspaceStore.set(normalized)
      } catch (_) { /* store 未 init 时静默 */ }
      const resp = { requestId: reqId, success: true, path: normalized }
      ws.send('workspace:open', resp)
      return resp
    } catch (err) {
      ws.send('workspace:open', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }

  /**
   * workspace:current — 当前工作区 path（无工作区时为 null）。
   */
  async _handleCurrent(ws, msg) {
    const { requestId } = msg || {}
    const reqId = requestId || genRequestId()
    try {
      const wm = this._resolveWorkspaceManager()
      const current = wm && typeof wm.current === 'function' ? wm.current() : null
      const path = (current && current.path) || null
      const resp = { requestId: reqId, success: true, path }
      ws.send('workspace:current', resp)
      return resp
    } catch (err) {
      ws.send('workspace:current', { requestId: reqId, success: false, error: err.message })
      return { success: false, error: err.message }
    }
  }
}

module.exports = RemoteWorkspaceApi
