'use strict'

// RemoteServer 测试：HTTP + WebSocket（127.0.0.1）认证握手 + 白名单路由 + FanoutSink 推送
// 用真实 ws 客户端连本机随机端口（port:0 → 返回实际端口），apis 全部注入 mock。
// SecurityLog 落库复用 tests/jest.setup.js 指向的临时 USER_DATA_PATH sqlite 库（与 R4 测试一致）。
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')
const RemoteServer = require('../RemoteServer')
const RemoteAuth = require('../RemoteAuth')
const { FanoutSink } = require('../FanoutSink')
const { SecurityLog: SecurityLogModel, sequelize } = require('../../db/database')

const SERVER_HOST = '127.0.0.1'

// 生成一个独立的临时 userDataDir（模拟一台"机器"的 userData）
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remoteserver-'))
}

// 连接本地 WS（随机端口已由 start 返回）
function connectWs(port, pathName = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${SERVER_HOST}:${port}${pathName}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

// 等待下一条可 JSON 解析的消息
function onceMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error('等待服务端消息超时'))
    }, timeoutMs)
    const onMsg = (data) => {
      clearTimeout(timer)
      ws.off('message', onMsg)
      resolve(JSON.parse(data.toString()))
    }
    ws.on('message', onMsg)
  })
}

// 等待 ws 关闭，返回 { code, reason }
function waitForClose(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 ws 关闭超时')), timeoutMs)
    ws.on('close', (code, reason) => {
      clearTimeout(timer)
      resolve({ code, reason: reason.toString() })
    })
  })
}

// HTTP POST JSON
async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, body: data }
}

describe('RemoteServer（HTTP + WebSocket，127.0.0.1）', () => {
  let tmpDir
  let auth
  let fanout
  let apis
  let server
  let port

  beforeAll(async () => {
    await SecurityLogModel.sync()
  })

  beforeEach(async () => {
    await SecurityLogModel.destroy({ truncate: true })

    tmpDir = makeTmpDir()
    // 电脑端 deviceId 限流兜底：已配对设备连续失败 10 次锁 30 分钟（复用 auth 可调参数）
    auth = new RemoteAuth({ maxLoginFailures: 10, lockoutMs: 30 * 60 * 1000 })
    auth.init({ userDataDir: tmpDir })
    auth.setPassword('right-pw')
    auth.setEnabled(true)

    fanout = new FanoutSink()
    apis = {
      agent: { handleMessage: jest.fn() },
      session: { handleMessage: jest.fn() },
      workspace: { handleMessage: jest.fn() },
      image: { handleUpload: jest.fn().mockResolvedValue({ ok: true, path: '/tmp/x.jpg', name: 'x.jpg' }) }
    }

    server = new RemoteServer()
    const r = await server.start({ port: 0, auth, fanout, apis, publicAddr: 'wss://example.cloud/concrete/ws' })
    port = r.port
  })

  afterEach(async () => {
    if (server) { await server.stop(); server = null }
    if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  // 建一台已配对设备并拿到合法 token
  async function makePairedDevice(pw = 'right-pw') {
    const { code } = auth.generatePairCode()
    const pairRes = await postJson(`http://${SERVER_HOST}:${port}/api/pair`, { code })
    expect(pairRes.body.ok).toBe(true)
    const deviceId = pairRes.body.deviceId
    const loginRes = await postJson(`http://${SERVER_HOST}:${port}/api/login`, { password: pw, deviceId })
    expect(loginRes.body.ok).toBe(true)
    return { deviceId, token: loginRes.body.token }
  }

  // ---- 绑定 127.0.0.1 ----

  test('服务只绑定 127.0.0.1', () => {
    const addr = server._server.address()
    expect(addr.address).toBe('127.0.0.1')
    expect(typeof port).toBe('number')
  })

  test('start 返回实际监听端口（随机端口时可连接）', async () => {
    const ws = await connectWs(port)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  // ---- WS 认证握手 ----

  test('未认证：首帧非 auth → 服务端拒绝并关闭', async () => {
    const ws = await connectWs(port)
    const closed = waitForClose(ws)
    ws.send(JSON.stringify({ type: 'ping' }))
    const { code } = await closed
    expect(code).toBe(1008) // POLICY_VIOLATION
  })

  test('auth 帧版本不匹配 → 返回 VERSION_MISMATCH 并关闭', async () => {
    const { token } = await makePairedDevice()
    const ws = await connectWs(port)
    const msgP = onceMessage(ws)
    const closedP = waitForClose(ws)
    ws.send(JSON.stringify({ type: 'auth', token, version: 999 }))
    const msg = await msgP
    expect(msg).toEqual({ type: 'error', error: 'VERSION_MISMATCH' })
    const { code } = await closedP
    expect(code).toBe(1008)
  })

  test('无效 token → 返回 AUTH_FAILED 并关闭', async () => {
    const ws = await connectWs(port)
    const msgP = onceMessage(ws)
    const closedP = waitForClose(ws)
    ws.send(JSON.stringify({ type: 'auth', token: 'bad-token', version: 1 }))
    const msg = await msgP
    expect(msg).toEqual({ type: 'error', error: 'AUTH_FAILED' })
    const { code } = await closedP
    expect(code).toBe(1008)
  })

  test('合法 auth（携带 token+version）→ 回 auth_ok 并注册为 FanoutSink 目标', async () => {
    const { token } = await makePairedDevice()
    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    const msg = await onceMessage(ws)
    expect(msg).toEqual({ type: 'auth_ok' })

    // 已注册为扇出目标：fanout.send 能触达该 ws
    fanout.send('agent:progress', { type: 'delta', text: 'hi' })
    const pushed = await onceMessage(ws)
    expect(pushed).toEqual({ channel: 'agent:progress', payload: { type: 'delta', text: 'hi' } })
    ws.close()
  })

  test('ws 关闭后从 FanoutSink 自动移除（不再收到推送）', async () => {
    const { token } = await makePairedDevice()
    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    await onceMessage(ws) // auth_ok

    const closed = waitForClose(ws)
    ws.close()
    await closed
    await new Promise(r => setTimeout(r, 30))

    fanout.send('agent:progress', { type: 'delta', text: 'after-close' })
    expect(fanout.isDestroyed()).toBe(true) // 目标已移除，sink 为空
  })

  // ---- WS 白名单路由 ----

  test('认证后：白名单外通道 → CHANNEL_NOT_ALLOWED（连接不关闭）', async () => {
    const { token } = await makePairedDevice()
    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    await onceMessage(ws)

    ws.send(JSON.stringify({ type: 'evil:channel', x: 1 }))
    const msg = await onceMessage(ws)
    expect(msg).toEqual({ type: 'error', error: 'CHANNEL_NOT_ALLOWED' })
    expect(ws.readyState).toBe(WebSocket.OPEN) // 仅报错，不关闭
    ws.close()
  })

  test('认证后：白名单内通道分发到对应 apis 处理器', async () => {
    const { token } = await makePairedDevice()
    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    await onceMessage(ws)

    ws.send(JSON.stringify({ type: 'agent:run', sessionId: 's1', message: 'hello' }))
    await new Promise(r => setTimeout(r, 30))
    expect(apis.agent.handleMessage).toHaveBeenCalledTimes(1)
    const [wsArg, msgArg, fanoutArg] = apis.agent.handleMessage.mock.calls[0]
    expect(msgArg.type).toBe('agent:run')
    expect(msgArg.sessionId).toBe('s1')
    expect(fanoutArg).toBe(fanout)
    expect(typeof wsArg.send).toBe('function') // 处理器拿到可发送的目标
    ws.close()
  })

  test('todo:list 也路由到 agent 处理器（R6 归属）', async () => {
    const { token } = await makePairedDevice()
    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    await onceMessage(ws)

    ws.send(JSON.stringify({ type: 'todo:list' }))
    await new Promise(r => setTimeout(r, 30))
    expect(apis.agent.handleMessage).toHaveBeenCalledTimes(1)
    expect(apis.agent.handleMessage.mock.calls[0][1].type).toBe('todo:list')
    ws.close()
  })

  test('认证后处理器抛错 → 回 HANDLER_ERROR 错误帧', async () => {
    const { token } = await makePairedDevice()
    apis.workspace.handleMessage.mockImplementation(() => { throw new Error('boom') })
    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    await onceMessage(ws)

    ws.send(JSON.stringify({ type: 'workspace:listRecent' }))
    const msg = await onceMessage(ws)
    expect(msg).toEqual({ type: 'error', error: 'HANDLER_ERROR' })
    ws.close()
  })

  // ---- HTTP 端点 ----

  test('POST /api/pair：有效配对码 → { ok, deviceId }', async () => {
    const { code } = auth.generatePairCode()
    const { status, body } = await postJson(`http://${SERVER_HOST}:${port}/api/pair`, { code })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.deviceId).toMatch(/^dev_[0-9a-f]{16}$/)
  })

  test('POST /api/pair：无效配对码 → { ok:false, error }', async () => {
    const { status, body } = await postJson(`http://${SERVER_HOST}:${port}/api/pair`, { code: 'WRONGCODE' })
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('INVALID_CODE')
  })

  test('POST /api/login：密码正确 + 已配对 → { ok, token }，token 可 verifyToken', async () => {
    const { code } = auth.generatePairCode()
    const { body: pairBody } = await postJson(`http://${SERVER_HOST}:${port}/api/pair`, { code })
    const deviceId = pairBody.deviceId

    const { status, body } = await postJson(`http://${SERVER_HOST}:${port}/api/login`, { password: 'right-pw', deviceId })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.token).toMatch(/^[0-9a-f]{64}$/)

    const vt = auth.verifyToken(body.token)
    expect(vt.ok).toBe(true)
    expect(vt.deviceId).toBe(deviceId)
  })

  test('POST /api/login：未配对设备即使密码正确也被拒（P2-1 设备授权）', async () => {
    const { status, body } = await postJson(`http://${SERVER_HOST}:${port}/api/login`, {
      password: 'right-pw',
      deviceId: 'dev_never_paired'
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('DEVICE_NOT_PAIRED')
  })

  test('电脑端 /api/login：已配对 deviceId 连续失败 10 次锁 30 分钟', async () => {
    const { code } = auth.generatePairCode()
    const { body: pairBody } = await postJson(`http://${SERVER_HOST}:${port}/api/pair`, { code })
    const deviceId = pairBody.deviceId

    for (let i = 1; i <= 10; i++) {
      const { body } = await postJson(`http://${SERVER_HOST}:${port}/api/login`, { password: 'wrong-pw', deviceId })
      expect(body.ok).toBe(false)
      expect(body.error).toBe('WRONG_PASSWORD')
    }

    // 第 11 次（正确密码）仍被锁，锁定约 30 分钟
    const locked = await postJson(`http://${SERVER_HOST}:${port}/api/login`, { password: 'right-pw', deviceId })
    expect(locked.body.ok).toBe(false)
    expect(locked.body.error).toBe('LOCKED')
    expect(locked.body.retryAfterMs).toBeGreaterThan(29 * 60 * 1000)
    expect(locked.body.retryAfterMs).toBeLessThanOrEqual(30 * 60 * 1000)
  })

  test('POST /api/image：从 Authorization Bearer 头取 token 转发给 apis.image.handleUpload', async () => {
    const { token } = await makePairedDevice()
    const res = await fetch(`http://${SERVER_HOST}:${port}/api/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: 'some-image-bytes'
    })
    const body = await res.json()

    expect(apis.image.handleUpload).toHaveBeenCalledTimes(1)
    const [reqArg, ctx] = apis.image.handleUpload.mock.calls[0]
    expect(ctx).toEqual({ token })
    expect(reqArg.method).toBe('POST')
    expect(body.ok).toBe(true)
  })

  test('POST /api/image：apis.image 未注册 → 501 NOT_IMPLEMENTED', async () => {
    delete apis.image
    const res = await fetch(`http://${SERVER_HOST}:${port}/api/image`, {
      method: 'POST',
      headers: { Authorization: 'Bearer whatever' },
      body: 'x'
    })
    expect(res.status).toBe(501)
    const body = await res.json()
    expect(body.error).toBe('NOT_IMPLEMENTED')
  })

  test('未知 HTTP 路径 → 404', async () => {
    const res = await fetch(`http://${SERVER_HOST}:${port}/api/nope`)
    expect(res.status).toBe(404)
  })

  // ---- 配对码 addr 注入（R4 交接点） ----

  test('getPairCode 把 publicAddr 注入 generatePairCode 的 addr', () => {
    const pc = server.getPairCode()
    expect(pc.code).toMatch(/^[A-Z2-9]{8}$/)
    expect(pc.addr).toBe('wss://example.cloud/concrete/ws')
  })

  test('getFanoutSink 返回注入的 fanout', () => {
    expect(server.getFanoutSink()).toBe(fanout)
  })
})
