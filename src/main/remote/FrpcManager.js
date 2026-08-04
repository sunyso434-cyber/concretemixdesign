'use strict'

// FrpcManager（R12）：电脑端 frpc 子进程管理器，打通「砼智」到腾讯云 frps 的隧道。
//
// 拓扑 B1（云端 TLS 终结）：
//   - 云端 Nginx 终结 TLS（wss://www.concreteagent.cloud/concrete/ws），frps 只做 HTTP vhost
//   - 电脑端 frpc 用 type=http + customDomains=域名，把 RemoteServer 本地端口暴露到公网
//   - 手机连 wss://www.concreteagent.cloud/concrete/ws → Nginx 终结 TLS → frps(vhost 8080) → frpc → RemoteServer
//
// 配置：生成 <userData>/frpc.toml（frp ≥0.52 用 TOML，锁 v0.60.0）
// 子进程：spawn frpc -c <toml>；监听 exit 自动重启（指数退避）；stop() 清退避并 kill。
//
// 二进制路径（老板 2026-08-02 决策：内置隧道，应用启动即自动连接）：
//   源：dev 用 resources/frpc/win/frpc.exe；打包用 process.resourcesPath/frpc/win/frpc.exe
//   运行：每次 start 把 frpc.exe 复制到 <userData>/frpc/ 再 spawn —— 统一 dev/打包路径，
//         升级自动替换新版本，并绕过 Windows Defender 对项目/资源路径的执行拦截（实测临时目录副本可正常执行）。
//
// 纯 Node：不 require electron。路径可由调用方注入 resourcePath，
//   否则自动判断（dev 用项目 resources；生产用 process.resourcesPath）。
// 依赖注入：childProcess/fs/now 可在测试时替换（见 __tests__/FrpcManager.test.js）。

const path = require('path')
const crypto = require('crypto')

const TOML_FILENAME = 'frpc.toml'
const PC_ID_FILENAME = 'remote-pc-id.json' // PC 身份证文件（持久化，首次生成）
const BASE_DOMAIN = 'concreteagent.cloud'  // 通配符证书覆盖的根域名（多电脑并存方案）
const DEFAULT_RETRY_BASE_MS = 1000 // 首次重启退避 1s
const DEFAULT_RETRY_MAX_MS = 60000 // 退避封顶 60s
const DEFAULT_RETRY_FACTOR = 2
const STOP_KILL_WAIT_MS = 1000 // stop() 等待子进程退出的超时

/**
 * 资源二进制源目录：dev 用项目 resources；打包后 process.resourcesPath 存在则用其下。
 * （运行用 <userData>/frpc/ 下的副本，见 deployBinary —— 统一路径 + 绕过杀软对项目路径的拦截）
 */
function sourceBinaryDir() {
  if (process.env.NODE_ENV === 'development' || !process.resourcesPath) {
    return path.join(__dirname, '..', '..', '..', 'resources', 'frpc', 'win')
  }
  return path.join(process.resourcesPath, 'frpc', 'win')
}

/** TOML 基础字符串：用 JSON 转义的双引号（TOML 基础字符串转义集与 JSON 兼容）。 */
function tomlString(v) {
  return JSON.stringify(String(v))
}

/**
 * 把域名归一化（去掉协议前缀与尾部斜杠），供 customDomains 使用。
 * @param {string} domain
 * @returns {string}
 */
function normalizeDomain(domain) {
  return String(domain || '')
    .trim()
    .replace(/^wss?:\/\//, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

/**
 * 校验并返回正整数端口（R12 评审 Minor7：非正整数抛明确错误，
 * 避免生成 NaN 的 TOML 后 frpc 启动失败进入死循环退避）。
 * @param {*} v 端口值（数字或可转数字字符串）
 * @param {string} label 错误信息里的字段名
 * @returns {number}
 */
function toPositiveInt(v, label) {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`frp 配置 ${label} 必须是正整数（当前: ${v}）`)
  }
  return n
}

class FrpcManager {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.resourcePath] frpc.exe 所在目录（默认自动解析 dev/生产）
   * @param {string} [opts.userDataDir] frpc.toml 存放目录（<userData>）
   * @param {Object} [opts.childProcess] 注入 child_process（测试替换）
   * @param {Object} [opts.fs] 注入 fs（测试替换）
   * @param {number} [opts.retryBaseMs=1000] 首次重启退避
   * @param {number} [opts.retryMaxMs=60000] 退避封顶
   * @param {number} [opts.retryFactor=2] 退避倍率
   * @param {(kind:string,msg:string)=>void} [opts.onLog] 子进程 stdout/stderr/error 回调
   */
  constructor(opts = {}) {
    this._resourcePath = opts.resourcePath || sourceBinaryDir()
    this._userDataDir = opts.userDataDir || null
    this._child = opts.childProcess || require('child_process')
    this._fs = opts.fs || require('fs')
    this._retryBaseMs = opts.retryBaseMs != null ? opts.retryBaseMs : DEFAULT_RETRY_BASE_MS
    this._retryMaxMs = opts.retryMaxMs != null ? opts.retryMaxMs : DEFAULT_RETRY_MAX_MS
    this._retryFactor = opts.retryFactor != null ? opts.retryFactor : DEFAULT_RETRY_FACTOR
    this._onLog = opts.onLog || null

    /** @type {import('child_process').ChildProcess|null} */
    this._proc = null
    this._procExited = false // 当前进程是否已触发 exit（避免重复处理）
    this._restartTimer = null // 重启 setTimeout 句柄
    this._restartDelay = 0 // 当前退避间隔 ms
    this._stopping = false // stop() 已调用：退出后不再重启
    this._config = null // 当前连接配置 { serverAddr, serverPort, token, localPort, domain }
    this._lastError = null // 最近一次错误（面板展示隧道异常原因）
  }

  /** frpc 运行目录：<userData>/frpc（二进制从资源复制到此，统一路径 + 绕过杀软路径拦截）。 */
  runDir() {
    if (!this._userDataDir) throw new Error('FrpcManager 未设置 userDataDir，无法确定运行目录')
    return path.join(this._userDataDir, 'frpc')
  }

  /** frpc.exe 绝对路径（用户数据目录副本）。 */
  binaryPath() {
    return path.join(this.runDir(), 'frpc.exe')
  }

  /**
   * 把资源里的 frpc.exe 复制到 <userData>/frpc/（每次覆盖，升级自动替换新版本）。
   * Windows Defender 曾拦截项目/资源路径下的 frpc.exe 执行（临时目录副本正常），
   * 统一从用户数据目录运行可绕过该拦截。
   */
  deployBinary() {
    const src = path.join(this._resourcePath, 'frpc.exe')
    if (!this._fs.existsSync(src)) {
      throw new Error(`未找到 frpc.exe 源文件（${src}）：请确认资源已随应用分发`)
    }
    this._fs.mkdirSync(this.runDir(), { recursive: true })
    this._fs.copyFileSync(src, this.binaryPath())
    return this.binaryPath()
  }

  /** frpc.toml 绝对路径（<userData>/frpc.toml）。 */
  configPath() {
    if (!this._userDataDir) throw new Error('FrpcManager 未设置 userDataDir，无法写配置')
    return path.join(this._userDataDir, TOML_FILENAME)
  }

  /** 校验运行副本存在，缺失抛错（桌面启动前可提前感知）。 */
  ensureBinary() {
    const bin = this.binaryPath()
    if (!this._fs.existsSync(bin)) {
      throw new Error(`未找到 frpc.exe（${bin}）：请确认资源已随应用分发，或杀毒软件未隔离该文件`)
    }
    return bin
  }

  // ---------- PC ID 管理（多电脑并存方案）----------

  /** PC ID 文件路径（<userData>/remote-pc-id.json）。 */
  pcIdFilePath() {
    if (!this._userDataDir) throw new Error('FrpcManager 未设置 userDataDir，无法读写 PC ID')
    return path.join(this._userDataDir, PC_ID_FILENAME)
  }

  /**
   * 获取本机 PC ID（8 位 hex，如 "9b2c3a7f"）。
   * 首次调用时生成并持久化到 <userData>/remote-pc-id.json，后续直接读取。
   * PC ID 是这台电脑的永久身份证，用于：
   *   - frp 代理名：concrete-remote-<pcId>（避免多电脑重名冲突）
   *   - frp 子域名：<pcId>.concreteagent.cloud（手机扫码直连对应电脑）
   * @returns {string}
   */
  getPcId() {
    const existing = this._loadPcId()
    if (existing) return existing
    const id = crypto.randomBytes(4).toString('hex') // 8 位 hex
    this._savePcId(id)
    return id
  }

  /** 子域名（<pcId>.concreteagent.cloud），供 customDomains 和配对地址使用。 */
  getSubDomain() {
    return `${this.getPcId()}.${BASE_DOMAIN}`
  }

  /** 配对地址（wss://<pcId>.concreteagent.cloud/concrete/ws），供面板生成配对码用。 */
  getPairAddr() {
    return `wss://${this.getSubDomain()}/concrete/ws`
  }

  /** 内部：读取持久化的 PC ID（文件不存在/损坏时返回 null，由 getPcId 生成新的）。 */
  _loadPcId() {
    try {
      const data = JSON.parse(this._fs.readFileSync(this.pcIdFilePath(), 'utf8'))
      return data && typeof data.pcId === 'string' ? data.pcId : null
    } catch {
      return null
    }
  }

  /** 内部：原子写入 PC ID（临时文件 + rename，避免崩溃写坏）。 */
  _savePcId(id) {
    const filePath = this.pcIdFilePath()
    this._fs.mkdirSync(this._userDataDir, { recursive: true })
    const tmp = filePath + '.tmp'
    this._fs.writeFileSync(tmp, JSON.stringify({ pcId: id }))
    this._fs.renameSync(tmp, filePath)
  }

  /** 生成 frpc.toml 内容（frp v0.60.0 TOML 格式，type=http + customDomains）。
   *  多电脑并存方案：代理名和子域名都带 PC ID，避免冲突。 */
  buildToml({ serverAddr, serverPort, token, localPort, pcId }) {
    if (!serverAddr) throw new Error('frp 配置缺少 serverAddr')
    if (!token) throw new Error('frp 配置缺少 token')
    if (localPort == null) throw new Error('frp 配置缺少 localPort')
    if (!pcId) throw new Error('frp 配置缺少 pcId（多电脑并存方案必需）')
    const port = toPositiveInt(serverPort == null ? 7000 : serverPort, 'serverPort')
    const local = toPositiveInt(localPort, 'localPort')
    const subDomain = `${pcId}.${BASE_DOMAIN}`
    return [
      `serverAddr = ${tomlString(serverAddr)}`,
      `serverPort = ${port}`,
      `auth.token = ${tomlString(token)}`,
      '',
      '[[proxies]]',
      `name = "concrete-remote-${pcId}"`,
      'type = "http"',
      `customDomains = [${tomlString(subDomain)}]`,
      'localIP = "127.0.0.1"',
      `localPort = ${local}`,
      ''
    ].join('\n')
  }

  /** 把配置写到 <userData>/frpc.toml。 */
  writeConfig(cfg) {
    if (!this._userDataDir) throw new Error('FrpcManager 未设置 userDataDir，无法写配置')
    this._fs.mkdirSync(this._userDataDir, { recursive: true })
    this._fs.writeFileSync(this.configPath(), this.buildToml(cfg), 'utf8')
    return this.configPath()
  }

  /**
   * 启动 frpc（幂等：已有进程时先停再起）。
   * 写 <userData>/frpc.toml → spawn frpc -c <toml> → 监听 exit 自动指数退避重启。
   * @param {{ serverAddr:string, serverPort:number, token:string, localPort:number, domain:string }} cfg
   * @returns {Promise<{ started: boolean, pid?: number, configPath: string, binaryPath: string }>}
   */
  async start(cfg) {
    // 每次启动先刷新 userData 副本（新版本覆盖 + 绕过杀软路径拦截），再校验
    this.deployBinary()
    const bin = this.ensureBinary()
    if (this._proc && !this._procExited) {
      await this.stop() // 先清理旧进程与旧退避
    }
    // 多电脑并存方案：注入 PC ID（buildToml 生成唯一代理名 + 子域名）
    const pcId = this.getPcId()
    const cfgWithPcId = { ...cfg, pcId }
    this._config = { ...cfgWithPcId }
    this._lastError = null
    this._restartDelay = 0
    this._stopping = false
    const cfgPath = this.writeConfig(cfgWithPcId)
    const proc = this._spawn()
    return { started: true, pid: proc.pid, configPath: cfgPath, binaryPath: bin }
  }

  /** 内部：拉起一个 frpc 子进程并挂监听（不等待连接成功）。 */
  _spawn() {
    this._procExited = false
    const bin = this.binaryPath()
    const cfgPath = this.configPath()
    const log = this._onLog
    const proc = this._child.spawn(bin, ['-c', cfgPath], {
      windowsHide: true, // Windows 下不弹黑窗
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this._proc = proc
    if (proc.stdout) {
      proc.stdout.on('data', (d) => log && log('stdout', String(d)))
    }
    if (proc.stderr) {
      proc.stderr.on('data', (d) => log && log('stderr', String(d)))
    }
    // spawn ENOENT / 杀软拦截（EACCES）等启动失败走 error；运行中被杀/退出走 exit。
    proc.on('error', (err) => {
      const msg = err && err.message ? err.message : String(err)
      this._lastError = msg
      log && log('error', msg)
      this._handleExit({ err })
    })
    proc.on('exit', (code, signal) => {
      if (code !== 0) {
        this._lastError = `frpc 退出（code=${code} signal=${signal}），自动重连中`
      }
      this._handleExit({ code, signal })
    })
    return proc
  }

  /** 内部：统一处理子进程退出——标记、清引用、按需退避重启。 */
  _handleExit(info) {
    const log = this._onLog
    const code = info && info.code
    const signal = info && info.signal
    log && log('exit', `code=${code} signal=${signal}`)
    if (this._proc && this._procExited === false) {
      this._procExited = true
    }
    this._proc = null
    if (this._stopping || this._procExited === false) return // stop() 后或重复回调不重启
    this._scheduleRestart()
  }

  /** 指数退避：1s → 2s → 4s … 封顶 60s；stop() 会清掉挂起的 timer。 */
  _scheduleRestart() {
    if (this._stopping) return
    if (this._restartTimer) clearTimeout(this._restartTimer)
    const delay = this._restartDelay > 0
      ? Math.min(this._restartDelay * this._retryFactor, this._retryMaxMs)
      : this._retryBaseMs
    this._restartDelay = delay
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null
      if (this._stopping) return
      if (this._onLog) this._onLog('restart', `退避 ${delay}ms 后重启 frpc`)
      try {
        this._spawn()
      } catch (err) {
        if (this._onLog) this._onLog('error', `重启失败: ${err.message}`)
      }
    }, delay)
  }

  /**
   * 停止 frpc：清退避 timer、标记停止、kill 子进程（等它退出，超时兜底）。
   * @returns {Promise<{ stopped: boolean }>}
   */
  async stop() {
    this._stopping = true
    if (this._restartTimer) {
      clearTimeout(this._restartTimer)
      this._restartTimer = null
    }
    const proc = this._proc
    if (!proc) return { stopped: true }
    if (this._procExited) {
      this._proc = null
      return { stopped: true }
    }
    await new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        this._proc = null
        resolve()
      }
      const timer = setTimeout(finish, STOP_KILL_WAIT_MS) // kill 后进程迟迟不退出的兜底
      proc.once('exit', finish)
      let killed = false
      try {
        killed = proc.kill() // SIGTERM（Windows 下为终止）
      } catch {
        killed = false
      }
      if (!killed) finish() // 进程已死/不可 kill：直接收尾
    })
    return { stopped: true }
  }

  /** 当前是否有一个运行中的 frpc 子进程。 */
  isRunning() {
    return !!(this._proc && !this._procExited)
  }

  /** 当前进程 pid（无则 null）。 */
  get pid() {
    return this._proc && !this._procExited ? this._proc.pid : null
  }

  /** 当前运行状态快照。 */
  getStatus() {
    let pcId = null
    let pairAddr = null
    if (this._userDataDir) {
      try {
        pcId = this.getPcId()
        pairAddr = this.getPairAddr()
      } catch { /* 文件系统异常，忽略 */ }
    }
    return {
      running: this.isRunning(),
      pid: this.pid,
      pcId,
      pairAddr,
      configPath: this._userDataDir ? this.configPath() : null,
      config: this._config ? { ...this._config, token: undefined } : null, // 不回传 token
      lastError: this._lastError // 最近一次错误（面板展示隧道异常原因）
    }
  }

  // 测试专用：重置内部状态（jest 单进程共享模块缓存场景下隔离实例）。
  _resetForTest() {
    if (this._restartTimer) clearTimeout(this._restartTimer)
    this._proc = null
    this._procExited = false
    this._restartTimer = null
    this._restartDelay = 0
    this._stopping = false
    this._config = null
  }
}

module.exports = {
  FrpcManager,
  normalizeDomain,
  sourceBinaryDir,
  BASE_DOMAIN,
  TOML_FILENAME
}
