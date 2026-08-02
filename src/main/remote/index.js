'use strict'

// ============================================================
// RemoteService（R11）：远程模块组装层。
//
// 把 R2-R10 的远程模块接到一个共享实例上：
//   - 共享 FanoutSink：桌面 webContents（main.js createWindow 注册）+ 已连接手机 ws 都是目标
//   - RemoteAuth：init({ userDataDir })；电脑端登录限流兜底 10 次 / 30 分钟（R5 交接）
//   - RemoteServer：只绑 127.0.0.1，本地不配证书（TLS 由云端 Nginx 终结，R12 frp）
//   - apis 嵌套对象 { agent, session, workspace, image }（R5 契约）
//   - RemoteAgentBridge 经 agentHandler.getExecutor() 取同一 executor 单例（P1-2，不得 new）
//   - agentHandler.setFanout(共享 fanout)：桌面路径 sink 切到共享 FanoutSink（P1-1）
//
// 模块级单例（懒初始化）：main.js 只调 start({ userDataDir }) 一次；
// remotePanelHandler 经注入的 remoteService 在启用/停用开关时联动 startListening/stopListening。
// 纯 Node（不 require electron）：agentHandler 懒加载（其内部 require electron，
// 但 getExecutor/setFanout 只在真实 Electron 运行时被调用）。
// ============================================================

const { FanoutSink } = require('./FanoutSink')
const RemoteAuth = require('./RemoteAuth')
const RemoteServer = require('./RemoteServer')
const RemoteAgentBridge = require('./RemoteAgentBridge')
const RemoteSessionApi = require('./RemoteSessionApi')
const RemoteWorkspaceApi = require('./RemoteWorkspaceApi')
const RemoteImageApi = require('./RemoteImageApi')

// 本地监听端口（本机调试 ws://127.0.0.1:<port>；生产由 frp 隧道转发到本端口，R12）
const DEFAULT_PORT = 46351

let _state = null // { userDataDir, auth, fanout, server, bridge, sessionApi, workspaceApi, imageApi, port, listening }

/**
 * 组装远程模块（幂等：同一 userDataDir 只 wire 一次）。
 * 未启用远程认证时不监听端口，仅保证面板可用的模块就绪。
 */
function ensureWired({ userDataDir }) {
  if (_state && _state.userDataDir === userDataDir) return _state

  const fanout = new FanoutSink()
  const auth = new RemoteAuth({ maxLoginFailures: 10, lockoutMs: 30 * 60 * 1000 }) // R5 交接：10 次 / 30 分
  auth.init({ userDataDir })

  // P1-2：经 agentHandler.getExecutor() 取同一 executor 单例（不得再 createAgentExecutor）
  // agentHandler 在真实 Electron 里模块顶层已创建 executor；这里只读不 new
  const agentHandler = require('../ipcHandlers/agentHandler')
  const executor = typeof agentHandler.getExecutor === 'function' ? agentHandler.getExecutor() : null
  const bridge = new RemoteAgentBridge({ executor })
  const sessionApi = new RemoteSessionApi()
  const workspaceApi = new RemoteWorkspaceApi()
  const imageApi = new RemoteImageApi({ auth })

  // P1-1：桌面路径 sink 切到共享 FanoutSink
  // （桌面 webContents 已由 main.js createWindow 注册为目标 → 桌面自扇出仍收到；手机也收到）
  if (typeof agentHandler.setFanout === 'function') {
    agentHandler.setFanout(fanout)
  }

  const server = new RemoteServer()
  const state = {
    userDataDir,
    auth,
    fanout,
    server,
    bridge,
    sessionApi,
    workspaceApi,
    imageApi,
    port: null,
    listening: false
  }
  _state = state
  return state
}

/** apis 嵌套对象（R5 契约：RemoteServer 白名单按 agent/session/workspace/image 键分发）。 */
function buildApis(state) {
  return {
    agent: state.bridge,
    session: state.sessionApi,
    workspace: state.workspaceApi,
    image: state.imageApi
  }
}

/**
 * 启动远程服务（app ready 时调一次）。
 * 默认不启用：未启用时不监听端口，仅面板可用；启动失败由调用方 catch（不阻塞桌面启动）。
 * @param {{ userDataDir: string }} param
 * @returns {Promise<{ enabled: boolean, listening: boolean, port?: number }>}
 */
async function start({ userDataDir }) {
  const state = ensureWired({ userDataDir })
  if (!state.auth.isEnabled()) {
    return { enabled: false, listening: false }
  }
  return startListening()
}

/**
 * 开始监听本地端口（remotePanelHandler 在启用开关时联动调用）。
 * @param {{ port?: number }} [options] port 缺省用 DEFAULT_PORT；传 0 由系统分配随机端口
 * @returns {Promise<{ enabled: boolean, listening: boolean, port?: number }>}
 */
async function startListening({ port = DEFAULT_PORT } = {}) {
  const state = _state
  if (!state) throw new Error('RemoteService 未 start：请先调用 start({ userDataDir })')
  if (state.listening) return { enabled: true, listening: true, port: state.port }
  const { port: actualPort } = await state.server.start({
    port,
    auth: state.auth,
    fanout: state.fanout,
    apis: buildApis(state),
    publicAddr: null // 本地无证书；手机端地址由 remote-config.json 的 domain 提供
  })
  state.port = actualPort
  state.listening = true
  return { enabled: true, listening: true, port: actualPort }
}

/** 停止监听（remotePanelHandler 在停用开关时联动调用）。 */
async function stopListening() {
  const state = _state
  if (!state || !state.listening) return { enabled: false, listening: false }
  await state.server.stop()
  state.port = null
  state.listening = false
  return { enabled: false, listening: false }
}

/** 停止远程服务（应用退出时可选调用）。 */
async function stop() {
  await stopListening()
}

/** 远程认证开关是否启用。 */
function isEnabled() {
  return _state ? _state.auth.isEnabled() : false
}

/** 共享 FanoutSink（main.js createWindow 时注册桌面 webContents 目标）。 */
function getFanout() {
  return _state ? _state.fanout : null
}

/** RemoteServer 实例（remotePanelHandler 面板在线客户端状态用）。 */
function getServer() {
  return _state ? _state.server : null
}

/** RemoteAuth 共享实例（remotePanelHandler 注入，避免懒创建不同步）。 */
function getAuth() {
  return _state ? _state.auth : null
}

// 测试专用：重置模块级单例（jest 单进程共享模块缓存）
function _resetForTest() {
  _state = null
}

module.exports = {
  start,
  stop,
  startListening,
  stopListening,
  isEnabled,
  getFanout,
  getServer,
  getAuth,
  DEFAULT_PORT,
  _resetForTest
}
