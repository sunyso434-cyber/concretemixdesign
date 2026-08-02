'use strict'

// RemoteService（R11 组装层）冒烟测试：
//   - index.js 组装各模块（fanout/auth/server、apis 嵌套结构、executor 单例注入）
//   - start 默认不监听端口（未启用远程认证）
//   - 启用后 startListening 监听 127.0.0.1，ws 端口可连
//   - setFanout 被调用：桌面路径 sink 切到共享 FanoutSink（P1-1）
//   - 桌面 target 注册进共享 fanout 后，fanout.send 被桌面收到（自扇出）
//
// agentHandler 用 jest.mock 隔离（避免拉 electron + 重依赖）；
// electron 也 mock（RemoteImageApi → visionHandler 顶层会调 ipcMain.handle，纯 Node 环境需拦截）。
jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() }, shell: {} }))
jest.mock('../../ipcHandlers/agentHandler', () => ({
  getExecutor: jest.fn(),
  setFanout: jest.fn()
}))

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

  test('组装：未启用时 start 不监听端口，但模块就绪（fanout/auth/server）', async () => {
    const r = await remoteService.start({ userDataDir: tmpDir })
    expect(r.enabled).toBe(false)
    expect(r.listening).toBe(false)

    // 共享实例就绪
    expect(remoteService.getFanout()).toBeInstanceOf(FanoutSink)
    expect(remoteService.getAuth()).toBeTruthy()
    expect(remoteService.getServer()).toBeTruthy()
    // 未监听：server 未创建底层 HTTP server
    expect(remoteService.getServer()._server).toBeNull()

    // RemoteAuth 用 R5 兜底参数：10 次 / 30 分
    const auth = remoteService.getAuth()
    expect(auth._maxLoginFailures).toBe(10)
    expect(auth._lockoutMs).toBe(30 * 60 * 1000)
  })

  test('setFanout 被调：桌面路径 sink 切到共享 FanoutSink（P1-1）', async () => {
    await remoteService.start({ userDataDir: tmpDir })
    expect(agentHandler.setFanout).toHaveBeenCalledTimes(1)
    expect(agentHandler.setFanout.mock.calls[0][0]).toBe(remoteService.getFanout())
  })

  test('启用后 startListening：监听 127.0.0.1，apis 为嵌套对象，bridge 用 getExecutor 的同一 executor', async () => {
    const executor = { runAgentSession: jest.fn() }
    agentHandler.getExecutor.mockReturnValue(executor)
    await remoteService.start({ userDataDir: tmpDir }) // 先 wire（未启用，不监听）

    const auth = remoteService.getAuth()
    auth.setPassword('pw123')
    auth.setEnabled(true)

    const r = await remoteService.startListening({ port: 0 })
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
    await remoteService.start({ userDataDir: tmpDir })
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
    await remoteService.start({ userDataDir: tmpDir }) // 先 wire
    const auth = remoteService.getAuth()
    auth.setPassword('pw123')
    auth.setEnabled(true)
    await remoteService.startListening({ port: 0 })
    expect(remoteService.getServer()._server).toBeTruthy()

    await remoteService.stopListening()
    expect(remoteService.getServer()._server).toBeNull()
    expect(remoteService.getServer()._started).toBe(false)
  })

  test('在线客户端口径：只算已认证的手机 ws，桌面 webContents（fanout target）不计入（I1）', async () => {
    await remoteService.start({ userDataDir: tmpDir }) // 先 wire
    const auth = remoteService.getAuth()
    auth.setPassword('pw123')
    auth.setEnabled(true)
    const r = await remoteService.startListening({ port: 0 })
    const port = r.port
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
