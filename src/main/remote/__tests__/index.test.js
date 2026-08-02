'use strict'

// RemoteService（R11 组装层）冒烟测试：
//   - index.js 组装各模块（fanout/auth/server、apis 嵌套结构、executor 单例注入）
//   - start 全自动就绪（老板 2026-08-02 决策）：认证自动启用 + 首次生成密码 + 监听 + frpc 隧道自动启动
//   - applyEnabled 开关联动：停用 → 认证/监听/隧道全关；启用 → 全部恢复
//   - setFanout 被调用：桌面路径 sink 切到共享 FanoutSink（P1-1）
//   - 桌面 target 注册进共享 fanout 后，fanout.send 被桌面收到（自扇出）
//
// agentHandler 用 jest.mock 隔离（避免拉 electron + 重依赖）；
// electron 也 mock（RemoteImageApi → visionHandler 顶层会调 ipcMain.handle，纯 Node 环境需拦截）；
// FrpcManager mock（start 全自动会启动隧道，测试注入假实现，不真实 spawn）。
jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() }, shell: {} }))
jest.mock('../../ipcHandlers/agentHandler', () => ({
  getExecutor: jest.fn(),
  setFanout: jest.fn()
}))
// FrpcManager mock：全自动就绪后 start() 会启动隧道，测试注入假实现（记录配置、不真实 spawn）
jest.mock('../FrpcManager', () => {
  class MockFrpcManager {
    constructor(opts) {
      this.opts = opts
      this.started = []
      this._running = false
    }
    async start(cfg) {
      this.started.push(cfg)
      this._running = true
      return { started: true }
    }
    async stop() {
      this._running = false
      return { stopped: true }
    }
    isRunning() { return this._running }
    getStatus() { return { running: this._running } }
  }
  return { FrpcManager: MockFrpcManager }
})

const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')
const remoteService = require('../index')
const { FanoutSink } = require('../FanoutSink')
const { SecurityLog: SecurityLogModel, sequelize } = require('../../db/database')
const agentHandler = require('../../ipcHandlers/agentHandler')

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remoteidx-'))
}

function connectWs(port, pathName = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathName}`)
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

// HTTP POST JSON
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, body: data }
}

describe('RemoteService（R11 组装）', () => {
  let tmpDir

  beforeAll(async () => {
    // pair/login 会写 SecurityLog；建表避免写库噪音（与 RemoteAuth.test 同款）
    await SecurityLogModel.sync()
  })

  afterAll(async () => {
    await sequelize.close()
  })

  beforeEach(() => {
    tmpDir = makeTmpDir()
    agentHandler.getExecutor.mockReset()
    agentHandler.setFanout.mockReset()
  })

  afterEach(async () => {
    await remoteService.stop().catch(() => {})
    remoteService._resetForTest()
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  test('start：全自动就绪——认证自动启用 + 首次生成密码 + 监听端口 + frpc 隧道自动启动（老板 2026-08-02 决策）', async () => {
    const r = await remoteService.start({ userDataDir: tmpDir, port: 0 })
    expect(r.enabled).toBe(true)
    expect(r.listening).toBe(true)
    expect(typeof r.port).toBe('number')

    // 共享实例就绪
    expect(remoteService.getFanout()).toBeInstanceOf(FanoutSink)
    expect(remoteService.getAuth()).toBeTruthy()
    expect(remoteService.getServer()).toBeTruthy()
    expect(remoteService.getFrpc()).toBeTruthy()

    // 认证自动启用 + 首次自动生成密码（面板可重置查看）
    const auth = remoteService.getAuth()
    expect(auth.isEnabled()).toBe(true)
    expect(auth.hasPassword()).toBe(true)

    // RemoteAuth 用 R5 兜底参数：10 次 / 30 分
    expect(auth._maxLoginFailures).toBe(10)
    expect(auth._lockoutMs).toBe(30 * 60 * 1000)

    // frpc 已用写死默认配置启动，localPort 跟随实际监听端口
    const frpc = remoteService.getFrpc()
    expect(frpc.started).toHaveLength(1)
    expect(frpc.started[0]).toMatchObject({
      serverAddr: '43.153.116.131',
      serverPort: 7000,
      domain: 'www.concreteagent.cloud'
    })
    expect(frpc.started[0].localPort).toBe(r.port)
  })

  test('setFanout 被调：桌面路径 sink 切到共享 FanoutSink（P1-1）', async () => {
    await remoteService.start({ userDataDir: tmpDir, port: 0 })
    expect(agentHandler.setFanout).toHaveBeenCalledTimes(1)
    expect(agentHandler.setFanout.mock.calls[0][0]).toBe(remoteService.getFanout())
  })

  test('start 后监听 127.0.0.1，apis 为嵌套对象，bridge 用 getExecutor 的同一 executor', async () => {
    const executor = { runAgentSession: jest.fn() }
    agentHandler.getExecutor.mockReturnValue(executor)
    const r = await remoteService.start({ userDataDir: tmpDir, port: 0 })
    expect(r.listening).toBe(true)
    expect(typeof r.port).toBe('number')

    const server = remoteService.getServer()
    expect(server._server.address().address).toBe('127.0.0.1')

    // apis 嵌套对象 { agent, session, workspace, image }（R5 契约）
    const apis = server._apis
    expect(typeof apis.agent.handleMessage).toBe('function')
    expect(typeof apis.session.handleMessage).toBe('function')
    expect(typeof apis.workspace.handleMessage).toBe('function')
    expect(typeof apis.image.handleUpload).toBe('function')

    // bridge 经 getExecutor() 取同一 executor 单例（P1-2，不得 new）
    expect(apis.agent._executor).toBe(executor)

    // 真实 ws 端口可连（握手细节由 RemoteServer.test 覆盖，这里只验证组装后的监听）
    const ws = await connectWs(r.port)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  test('桌面事件自扇出：桌面 target 注册进共享 fanout 后，fanout.send 被桌面收到', async () => {
    await remoteService.start({ userDataDir: tmpDir, port: 0 })
    const fanout = remoteService.getFanout()

    const received = []
    const deskTarget = {
      send: (channel, payload) => received.push([channel, payload]),
      isDestroyed: () => false
    }
    fanout.addTarget(deskTarget)

    fanout.send('agent:progress', { type: 'delta', text: 'hello' })
    expect(received).toEqual([['agent:progress', { type: 'delta', text: 'hello' }]])

    fanout.removeTarget(deskTarget)
  })

  test('stopListening 停止监听，server 关闭', async () => {
    const r = await remoteService.start({ userDataDir: tmpDir, port: 0 })
    expect(r.listening).toBe(true)
    expect(remoteService.getServer()._server).toBeTruthy()

    await remoteService.stopListening()
    expect(remoteService.getServer()._server).toBeNull()
    expect(remoteService.getServer()._started).toBe(false)
  })

  test('applyEnabled(false)：停认证+停监听+停隧道；applyEnabled(true)：全部恢复', async () => {
    const r = await remoteService.start({ userDataDir: tmpDir, port: 0 })
    const auth = remoteService.getAuth()
    const frpc = remoteService.getFrpc()
    expect(auth.isEnabled()).toBe(true)
    expect(frpc.isRunning()).toBe(true)
    expect(remoteService.getServer()._server).toBeTruthy()

    // 停用：认证/监听/隧道全关
    const off = await remoteService.applyEnabled(false)
    expect(off.enabled).toBe(false)
    expect(auth.isEnabled()).toBe(false)
    expect(frpc.isRunning()).toBe(false)
    expect(remoteService.getServer()._server).toBeNull()

    // 启用：全部恢复（复用原随机端口，避免撞上默认端口 46351）
    const on = await remoteService.applyEnabled(true, { port: r.port })
    expect(on.enabled).toBe(true)
    expect(frpc.isRunning()).toBe(true)
    expect(remoteService.getServer()._server).toBeTruthy()
    // 密码已存在时不重新生成
    expect(on.tempPassword).toBeNull()
  })

  test('在线客户端口径：只算已认证的手机 ws，桌面 webContents（fanout target）不计入（I1）', async () => {
    const r = await remoteService.start({ userDataDir: tmpDir, port: 0 })
    const port = r.port
    const auth = remoteService.getAuth()
    auth.setPassword('pw123') // 覆盖启动时自动生成的随机密码，用固定密码做登录断言
    const server = remoteService.getServer()

    // 模拟桌面 webContents 注册进共享 fanout：不应计入在线客户端
    const fanout = remoteService.getFanout()
    const deskTarget = { send: jest.fn(), isDestroyed: () => false }
    fanout.addTarget(deskTarget)
    expect(server.getRemoteClientCount()).toBe(0)

    // 真实手机 ws：pair + login + auth 握手后计入 1
    const { code } = auth.generatePairCode()
    const pairRes = await postJson(`http://127.0.0.1:${port}/api/pair`, { code })
    expect(pairRes.body.ok).toBe(true)
    const deviceId = pairRes.body.deviceId
    const loginRes = await postJson(`http://127.0.0.1:${port}/api/login`, { password: 'pw123', deviceId })
    expect(loginRes.body.ok).toBe(true)
    const token = loginRes.body.token

    const ws = await connectWs(port)
    ws.send(JSON.stringify({ type: 'auth', token, version: 1 }))
    await onceMessage(ws) // auth_ok
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.getRemoteClientCount()).toBe(1)

    // 断开后递减回 0
    ws.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(server.getRemoteClientCount()).toBe(0)

    fanout.removeTarget(deskTarget)
  })
})
