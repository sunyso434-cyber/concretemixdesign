'use strict'

// RemoteServer：远程连接核心入口（HTTP + WebSocket，只绑 127.0.0.1）。
//
// 纯 Node 实现，不 require electron：
//   - HTTP 端点（http.createServer）：POST /api/pair（扫码配对）、POST /api/login（登录签发 token）、POST /api/image（转发给 apis.image）
//   - WS 端点（WebSocketServer，path: '/ws'）：首帧 { type:'auth', token, version } 握手 → auth_ok → 注册为 FanoutSink 目标；
//     认证后按白名单路由到 apis 处理器
//   - 本地不配证书：TLS 由云端 Nginx 终结（frp 隧道出站，见 R12）
//
// 依赖注入：auth（RemoteAuth 实例）、fanout（FanoutSink 实例）、apis（R6-R9 处理器对象）、publicAddr（配对码 addr 注入）。
// 电脑端 deviceId 登录限流复用 RemoteAuth 可调参数（maxLoginFailures / lockoutMs），R11 接线时按 brief 配置 10 次 / 30 分钟。

const http = require('http')
const { WebSocketServer } = require('ws')
const { wrapWs } = require('./FanoutSink')

// 协议版本：客户端 auth 帧携带 version，不匹配则拒绝
const PROTOCOL_VERSION = 1
const WS_AUTH_PATH = '/ws'
const MAX_JSON_BODY = 1024 * 1024 // HTTP JSON 请求体上限 1MB

// 通道白名单 → apis 处理器键（最小子集）
//  - agent:run/pause/resume/abort/confirm、todo:list → RemoteAgentBridge (R6)
//  - agent:listSessions/getSessionMessages/createSession/deleteSession/archiveSession/renameSession → RemoteSessionApi (R7)
//  - workspace:listRecent/open/current → RemoteWorkspaceApi (R8)
const ROUTE_TABLE = {
  'agent:run': 'agent',
  'agent:pause': 'agent',
  'agent:resume': 'agent',
  'agent:abort': 'agent',
  'agent:confirm': 'agent',
  'todo:list': 'agent',
  'agent:listSessions': 'session',
  'agent:getSessionMessages': 'session',
  'agent:createSession': 'session',
  'agent:deleteSession': 'session',
  'agent:archiveSession': 'session',
  'agent:renameSession': 'session',
  'workspace:listRecent': 'workspace',
  'workspace:open': 'workspace',
  'workspace:current': 'workspace'
}

class RemoteServer {
  constructor() {
    this._server = null
    this._wss = null
    this._auth = null
    this._fanout = null
    this._apis = {}
    this._publicAddr = null
    this._connections = new Set() // 当前 ws 连接状态：{ ws, wrapped, authenticated }
    this._started = false
  }

  /**
   * 启动 HTTP + WS 服务（只绑 127.0.0.1，port 传 0 则由系统分配随机端口）。
   * @param {{ port: number, auth: object, fanout: object, apis?: object, publicAddr?: string|null }} param
   * @returns {Promise<{ port: number }>} 实际监听端口
   */
  async start({ port, auth, fanout, apis, publicAddr }) {
    if (this._started) throw new Error('RemoteServer 已启动')
    if (!auth) throw new Error('RemoteServer.start 需要 auth（RemoteAuth 实例）')
    if (!fanout) throw new Error('RemoteServer.start 需要 fanout（FanoutSink 实例）')

    this._auth = auth
    this._fanout = fanout
    this._apis = apis || {}
    this._publicAddr = publicAddr || null

    this._server = http.createServer((req, res) => this._handleHttp(req, res).catch(() => {
      this._sendJson(res, 500, { error: 'INTERNAL_ERROR' })
    }))
    this._wss = new WebSocketServer({ server: this._server, path: WS_AUTH_PATH })
    this._wss.on('connection', (ws) => this._handleWsConnection(ws))

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        this._server.off('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        this._server.off('error', onError)
        resolve()
      }
      this._server.once('error', onError)
      this._server.once('listening', onListening)
      this._server.listen(port, '127.0.0.1')
    }).catch((err) => {
      // 启动失败（如端口占用）：清理已创建的 server/wss，避免残留
      try { if (this._wss) this._wss.close() } catch { /* 未监听 */ }
      try { if (this._server) this._server.close() } catch { /* 未监听 */ }
      this._wss = null
      this._server = null
      throw err
    })

    this._started = true
    return { port: this._server.address().port }
  }

  /**
   * 停止服务：关闭所有 ws 连接、WebSocketServer 与 HTTP server。
   */
  async stop() {
    this._started = false
    for (const conn of this._connections) {
      try { conn.ws.close(1000, 'server shutdown') } catch { /* 已关闭 */ }
    }
    this._connections.clear()

    if (this._wss) {
      try { this._wss.close() } catch { /* 已关闭 */ }
      this._wss = null
    }
    const server = this._server
    this._server = null
    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve())
        // 强制关闭 keep-alive 长连接，确保 close 回调触发
        try { server.closeAllConnections() } catch { /* Node<18.2 无此 API */ }
      })
    }
  }

  /** 返回注入的 FanoutSink（R11 接线用）。 */
  getFanoutSink() {
    return this._fanout
  }

  /** 生成配对码并注入 publicAddr（R4 交接点：RemoteAuth.generatePairCode 的 addr 置空，由本层注入监听地址）。 */
  getPairCode() {
    const pc = this._auth.generatePairCode()
    return { ...pc, addr: this._publicAddr }
  }

  // ---------- HTTP ----------

  async _handleHttp(req, res) {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      this._sendJson(res, 400, { error: 'BAD_REQUEST' })
      return
    }
    const pathName = url.pathname

    if (req.method === 'POST' && pathName === '/api/pair') {
      const body = await this._readJson(req)
      const result = await this._auth.pair({ code: body && body.code })
      this._sendJson(res, 200, result)
      return
    }

    if (req.method === 'POST' && pathName === '/api/login') {
      const body = await this._readJson(req)
      // 电脑端 deviceId 限流兜底由 RemoteAuth 完成（brief：已配对设备连续失败 10 次锁 30 分钟，R11 以可调参数注入）
      const result = await this._auth.login({ password: body && body.password, deviceId: body && body.deviceId })
      this._sendJson(res, 200, result)
      return
    }

    if (req.method === 'POST' && pathName === '/api/image') {
      // 骨架转发：token 从 Authorization: Bearer 头取；真实实现由 R9 RemoteImageApi 提供
      const token = bearerToken(req)
      const handler = this._apis && this._apis.image
      if (!handler || typeof handler.handleUpload !== 'function') {
        this._sendJson(res, 501, { ok: false, error: 'NOT_IMPLEMENTED' })
        return
      }
      const result = await handler.handleUpload(req, { token })
      const status = result && typeof result.status === 'number' ? result.status : 200
      this._sendJson(res, status, result)
      return
    }

    this._sendJson(res, 404, { error: 'NOT_FOUND' })
  }

  _readJson(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > MAX_JSON_BODY) {
          reject(new Error('BODY_TOO_LARGE'))
          req.destroy()
        }
      })
      req.on('end', () => {
        if (!data) return resolve(null)
        try { resolve(JSON.parse(data)) } catch (err) { reject(err) }
      })
      req.on('error', reject)
    })
  }

  _sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  // ---------- WebSocket ----------

  _handleWsConnection(ws) {
    const conn = { ws, wrapped: null, authenticated: false }
    this._connections.add(conn)

    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        this._rejectWs(ws, 'INVALID_JSON')
        return
      }
      if (!conn.authenticated) {
        this._handleAuthFrame(conn, msg)
        return
      }
      this._handleRequest(conn, msg)
    })

    ws.on('close', () => {
      this._connections.delete(conn)
      // wrapped 目标已通过 wrapWs 的 onClose 从 fanout 自动移除
    })

    ws.on('error', () => {
      try { ws.close() } catch { /* 已关闭 */ }
    })
  }

  /**
   * 认证握手：首帧必须是 { type:'auth', token, version }。
   * 通过 → 回 { type:'auth_ok' } → 注册为 FanoutSink 目标；失败 → 报错并关闭。
   */
  _handleAuthFrame(conn, msg) {
    if (!msg || typeof msg !== 'object' || msg.type !== 'auth') {
      this._rejectWs(conn.ws, 'AUTH_REQUIRED')
      return
    }
    // 协议版本：客户端携带 version 且不匹配 → 拒绝
    if (msg.version != null && msg.version !== PROTOCOL_VERSION) {
      this._rejectWs(conn.ws, 'VERSION_MISMATCH')
      return
    }
    const vt = this._auth.verifyToken(msg.token)
    if (!vt.ok) {
      this._rejectWs(conn.ws, 'AUTH_FAILED')
      return
    }

    conn.authenticated = true
    conn.wrapped = wrapWs(conn.ws)
    this._sendWs(conn.ws, { type: 'auth_ok' })
    this._fanout.addTarget(conn.wrapped)
  }

  /**
   * 认证后按白名单路由请求消息：{ type:'<通道>', ...payload }。
   * 白名单外通道 → CHANNEL_NOT_ALLOWED（连接不关闭）；分发到 apis 处理器（ws 传 wrapped 目标，便于 send(channel, payload)）。
   */
  _handleRequest(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      this._sendWs(conn.ws, { type: 'error', error: 'INVALID_MESSAGE' })
      return
    }
    const key = ROUTE_TABLE[msg.type]
    if (!key) {
      this._sendWs(conn.ws, { type: 'error', error: 'CHANNEL_NOT_ALLOWED' })
      return
    }
    const handler = this._apis && this._apis[key]
    if (!handler || typeof handler.handleMessage !== 'function') {
      this._sendWs(conn.ws, { type: 'error', error: 'HANDLER_NOT_REGISTERED' })
      return
    }
    // 骨架转发：fire-and-forget，处理器（R6-R9）负责回响应；同步抛错/异步拒绝 → HANDLER_ERROR
    try {
      const r = handler.handleMessage(conn.wrapped || conn.ws, msg, this._fanout)
      if (r && typeof r.catch === 'function') {
        r.catch(() => this._sendWs(conn.ws, { type: 'error', error: 'HANDLER_ERROR' }))
      }
    } catch {
      this._sendWs(conn.ws, { type: 'error', error: 'HANDLER_ERROR' })
    }
  }

  /** 发送一条原始 WS 帧并关闭（认证失败等拒绝场景）。 */
  _rejectWs(ws, error) {
    this._sendWs(ws, { type: 'error', error })
    try { ws.close(1008, error) } catch { /* 已关闭 */ }
  }

  _sendWs(ws, obj) {
    if (!ws || ws.readyState !== 1) return
    try { ws.send(JSON.stringify(obj)) } catch { /* 发送失败忽略 */ }
  }
}

// 从 Authorization: Bearer <token> 头提取 token
function bearerToken(req) {
  const header = req.headers && req.headers.authorization
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1].trim() : null
}

module.exports = RemoteServer
