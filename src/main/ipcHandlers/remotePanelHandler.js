'use strict'

// remotePanelHandler：桌面「远程连接」面板的 IPC 处理器（R10）
//
// 通道：
//   remote:getPairCode   → 生成配对码并注入 addr（wss://<domain>/concrete/ws）
//   remote:getStatus     → { enabled, pairedDevices, connectedClients, domain }
//   remote:setEnabled    → auth.setEnabled(v)；首次启用且未设密码时生成随机密码一次性返回
//   remote:resetPassword → 生成新随机密码（面板一次性展示）
//   remote:setDomain     → 保存域名到 <userData>/remote-config.json（R12 FrpcManager 读取）
//
// 依赖注入：register(refs)，refs 可选 { auth, remoteServer, remoteService }。
//   - R10 阶段 auth 可能未由 R11 接线，这里按需懒创建（绑定 app.getPath('userData')）；
//     R11 接好共享实例后注入 refs 即可覆盖（auth 必须注入共享实例，避免懒创建不同步）。
//   - remoteServer 未注入时 connectedClients 返回 0。
//   - remoteService 未注入时 setEnabled 只改 auth 不联动端口监听（R10 单跑行为）。
//
// 配置存储：<userData>/remote-config.json → { domain }（frp customDomains；证书由腾讯云持有，本地无证书）

const { app, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const RemoteAuth = require('../remote/RemoteAuth')

const CONFIG_FILE = 'remote-config.json'
const DEFAULT_DOMAIN = 'www.concreteagent.cloud'
const WS_PATH = '/concrete/ws'

let _refs = { auth: null, remoteServer: null, remoteService: null, frpcManager: null }
let _registered = false

// auth 懒初始化：R10 单独跑时也能自举；R11 注入共享实例后不再重复创建。
// R11 评审 M1：懒创建时也用 10 次 / 30 分（与 index.js 组装、R5 交接参数一致，别用默认 5 次 / 10 分）
function ensureAuth() {
  if (!_refs.auth) {
    const auth = new RemoteAuth({ maxLoginFailures: 10, lockoutMs: 30 * 60 * 1000 })
    auth.init({ userDataDir: app.getPath('userData') })
    _refs.auth = auth
  }
  return _refs.auth
}

function configFilePath() {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function loadConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(configFilePath(), JSON.stringify(cfg, null, 2))
  } catch (err) {
    throw new Error(`保存远程配置失败: ${err && err.message ? err.message : err}`)
  }
}

// 拼接手机端连接地址：域名归一化后加 wss 前缀与 /concrete/ws 路径
function buildAddr(domain) {
  const d = String(domain || '')
    .trim()
    .replace(/^wss?:\/\//, '')
    .replace(/\/+$/, '')
  return d ? `wss://${d}${WS_PATH}` : null
}

/**
 * 注册远程连接面板 IPC handlers（幂等）。
 * 仅首次调用时执行 ipcMain.handle；此后再次调用只合并更新 _refs，不重复注册
 * （避免 Electron 对同通道二次 handle 抛 "Attempted to register a second handler"）。
 * R11 注入共享 RemoteServer/FanoutSink 时再次调用 register 即可。
 * @param {{ auth?: object, remoteServer?: object, remoteService?: object, frpcManager?: object }} [refs]
 *   R11 注入共享实例；缺省时 auth 懒创建。frpcManager 用于面板显示隧道状态。
 */
function register(refs = {}) {
  _refs = { ..._refs, ...refs }
  if (_registered) return
  _registered = true

  ipcMain.handle('remote:getPairCode', () => {
    const auth = ensureAuth()
    const cfg = loadConfig()
    const pc = auth.generatePairCode()
    return { code: pc.code, expiresAt: pc.expiresAt, addr: buildAddr(cfg.domain) }
  })

  ipcMain.handle('remote:getStatus', () => {
    const auth = ensureAuth()
    const cfg = loadConfig()
    let connectedClients = 0
    const server = _refs.remoteServer
    if (server && typeof server.getRemoteClientCount === 'function') {
      // R11 评审 I1：只统计已认证的手机 ws，桌面 webContents（fanout target）不计入
      connectedClients = server.getRemoteClientCount()
    }
    // 隧道状态（R12 内置后：已连/未连 + 最近错误）
    let frpcRunning = false
    let frpcError = null
    const frpc = _refs.frpcManager
    if (frpc && typeof frpc.getStatus === 'function') {
      const s = frpc.getStatus()
      frpcRunning = !!s.running
      frpcError = s.lastError || null
    }
    return {
      enabled: auth.isEnabled(),
      hasPassword: auth.hasPassword(),
      pairedDevices: auth.getDeviceCount(),
      connectedClients,
      frpcRunning,
      frpcError,
      domain: cfg.domain || ''
    }
  })

  ipcMain.handle('remote:setEnabled', async (_e, payload = {}) => {
    const auth = ensureAuth()
    const v = !!payload.enabled
    // 内置隧道（老板 2026-08-02 决策）：开关联动 认证 + 监听 + 隧道
    // 注入 remoteService 时走 applyEnabled（启用→监听+隧道；停用→全关）；
    // 未注入时兜底只改 auth（R10 单跑行为）
    const svc = _refs.remoteService
    if (svc && typeof svc.applyEnabled === 'function') {
      return svc.applyEnabled(v)
    }
    auth.setEnabled(v)
    let tempPassword = null
    if (v && !auth.hasPassword()) {
      tempPassword = auth.generateRandomPassword()
      auth.setPassword(tempPassword)
    }
    return { enabled: auth.isEnabled(), tempPassword }
  })

  ipcMain.handle('remote:resetPassword', () => {
    const auth = ensureAuth()
    const pw = auth.generateRandomPassword()
    auth.setPassword(pw)
    return { password: pw }
  })

  ipcMain.handle('remote:setDomain', (_e, payload = {}) => {
    const cfg = loadConfig()
    cfg.domain = String(payload.domain == null ? '' : payload.domain).trim()
    saveConfig(cfg)
    return { domain: cfg.domain }
  })
}

module.exports = { register }
