'use strict'

// FrpcManager（R12）单元测试。
// 依赖注入：childProcess（mock spawn）/ resourcePath / userDataDir / fs（真实，用临时目录）。
// 覆盖：TOML 生成、二进制路径解析、start 写配置 + spawn 参数、指数退避重启、stop 清理、
//       退避封顶、start 幂等、getStatus 不泄露 token。

const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { FrpcManager, normalizeDomain } = require('../FrpcManager')

const CFG = {
  serverAddr: '43.153.116.131',
  serverPort: 7000,
  token: 'tok123',
  localPort: 46351,
  pcId: 'test1234' // 固定 PC ID 便于断言（多电脑并存方案）
}

/** 构造一个可 emit exit/error 的 mock frpc 子进程。 */
function makeProc() {
  const proc = new EventEmitter()
  proc.pid = 10000 + Math.floor(Math.random() * 50000)
  proc.kill = jest.fn(function kill() {
    proc.emit('exit', 0, null)
    return true
  })
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  return proc
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frpc-test-'))
}

/** 构造测试管理器：真实 fs + 临时目录 + mock spawn。 */
function makeManager({ tmpDir, resourcePath, spawn }) {
  return new FrpcManager({
    resourcePath,
    userDataDir: tmpDir,
    childProcess: { spawn },
    retryBaseMs: 1000,
    retryMaxMs: 60000,
    retryFactor: 2
  })
}

describe('FrpcManager（R12 frpc 子进程管理）', () => {
  let tmpDir
  let resourcePath
  let spawn
  let proc

  beforeEach(() => {
    tmpDir = makeTmpDir()
    // 模拟二进制：在临时 resourcePath 下放一个占位 frpc.exe（ensureBinary 用真实 fs 检查）
    resourcePath = path.join(tmpDir, 'bin')
    fs.mkdirSync(resourcePath, { recursive: true })
    fs.writeFileSync(path.join(resourcePath, 'frpc.exe'), 'placeholder')
    spawn = jest.fn()
    proc = makeProc()
    spawn.mockReturnValue(proc)
    jest.useRealTimers()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    jest.useRealTimers()
  })

  // ---------- TOML 生成 ----------
  test('buildToml：生成 frp v0.60.0 TOML（含 PC ID 唯一代理名 + 子域名）', () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    const toml = mgr.buildToml(CFG)
    expect(toml).toContain(`serverAddr = "43.153.116.131"`)
    expect(toml).toContain(`serverPort = 7000`)
    expect(toml).toContain(`auth.token = "tok123"`)
    expect(toml).toContain(`name = "concrete-remote-test1234"`)
    expect(toml).toContain('type = "http"')
    expect(toml).toContain(`customDomains = ["test1234.concreteagent.cloud"]`)
    expect(toml).toContain('localIP = "127.0.0.1"')
    expect(toml).toContain(`localPort = 46351`)
  })

  test('buildToml：缺少 pcId / token / localPort / serverAddr 时抛错', () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    expect(() => mgr.buildToml({ ...CFG, pcId: '' })).toThrow(/pcId/)
    expect(() => mgr.buildToml({ ...CFG, token: '' })).toThrow(/token/)
    expect(() => mgr.buildToml({ ...CFG, localPort: null })).toThrow(/localPort/)
    expect(() => mgr.buildToml({ ...CFG, serverAddr: '' })).toThrow(/serverAddr/)
  })

  test('buildToml：localPort / serverPort 非正整数时抛明确错误（避免 NaN TOML）', () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    for (const bad of [0, -1, 1.5, 'abc', NaN]) {
      expect(() => mgr.buildToml({ ...CFG, localPort: bad })).toThrow(/localPort.*正整数/)
    }
    for (const bad of [0, -1, 1.5, 'abc', NaN]) {
      expect(() => mgr.buildToml({ ...CFG, serverPort: bad })).toThrow(/serverPort.*正整数/)
    }
    // 合法数字字符串仍可用；serverPort 缺省 7000
    expect(mgr.buildToml({ ...CFG, localPort: '46351', serverPort: '7000' })).toContain('serverPort = 7000')
    expect(mgr.buildToml({ ...CFG, localPort: '46351', serverPort: undefined })).toContain('serverPort = 7000')
  })

  test('normalizeDomain：剥离协议前缀与尾部斜杠', () => {
    expect(normalizeDomain('wss://www.concreteagent.cloud/')).toBe('www.concreteagent.cloud')
    expect(normalizeDomain('https://a.com///')).toBe('a.com')
    expect(normalizeDomain('www.x.cn')).toBe('www.x.cn')
    expect(normalizeDomain('')).toBe('')
  })

  // ---------- 路径解析 / 部署副本 ----------
  test('binaryPath / configPath 正确（运行副本在 <userData>/frpc/frpc.exe）', () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    expect(mgr.binaryPath()).toBe(path.join(tmpDir, 'frpc', 'frpc.exe'))
    expect(mgr.configPath()).toBe(path.join(tmpDir, 'frpc.toml'))
  })

  test('deployBinary：把资源 frpc.exe 复制到 <userData>/frpc/（每次覆盖）', () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    const deployed = mgr.deployBinary()
    expect(deployed).toBe(path.join(tmpDir, 'frpc', 'frpc.exe'))
    expect(fs.readFileSync(deployed, 'utf8')).toBe('placeholder')

    // 源更新后再次部署：副本被覆盖（升级自动替换新版本）
    fs.writeFileSync(path.join(resourcePath, 'frpc.exe'), 'placeholder-v2')
    mgr.deployBinary()
    expect(fs.readFileSync(deployed, 'utf8')).toBe('placeholder-v2')
  })

  test('deployBinary：源缺失抛中文错误（不静默）', () => {
    fs.rmSync(path.join(resourcePath, 'frpc.exe'))
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    expect(() => mgr.deployBinary()).toThrow(/未找到 frpc\.exe/)
  })

  test('ensureBinary：运行副本缺失抛中文错误', () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    expect(() => mgr.ensureBinary()).toThrow(/未找到 frpc\.exe/) // 未部署时副本不存在
    mgr.deployBinary()
    expect(mgr.ensureBinary()).toBe(path.join(tmpDir, 'frpc', 'frpc.exe'))
  })

  test('资源二进制源目录：dev 环境走项目 resources/frpc/win', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const { sourceBinaryDir } = require('../FrpcManager')
      expect(sourceBinaryDir()).toContain(path.join('resources', 'frpc', 'win'))
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  // ---------- start / spawn ----------
  test('start：先部署副本到 <userData>/frpc/，写 frpc.toml，以 ["-c", tomlPath] spawn 运行副本', async () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    const r = await mgr.start(CFG)
    expect(r.started).toBe(true)
    expect(r.pid).toBe(proc.pid)

    // 运行副本已部署
    expect(fs.readFileSync(path.join(tmpDir, 'frpc', 'frpc.exe'), 'utf8')).toBe('placeholder')

    // toml 已落盘（start 内部用 getPcId 注入 PC ID，代理名 + 子域名都带 PC ID）
    const pcId = mgr.getPcId()
    const written = fs.readFileSync(path.join(tmpDir, 'frpc.toml'), 'utf8')
    expect(written).toContain('serverAddr = "43.153.116.131"')
    expect(written).toContain(`name = "concrete-remote-${pcId}"`)
    expect(written).toContain(`customDomains = ["${pcId}.concreteagent.cloud"]`)

    // spawn 参数与选项：从 userData 副本运行
    expect(spawn).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = spawn.mock.calls[0]
    expect(bin).toBe(path.join(tmpDir, 'frpc', 'frpc.exe'))
    expect(args).toEqual(['-c', path.join(tmpDir, 'frpc.toml')])
    expect(opts.windowsHide).toBe(true)
    expect(mgr.isRunning()).toBe(true)
  })

  test('start 幂等：已有运行中进程时先 stop 再起（spawn 两次，旧进程被 kill）', async () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    await mgr.start(CFG)
    const firstProc = spawn.mock.results[0].value
    expect(firstProc.kill).not.toHaveBeenCalled()

    const secondProc = makeProc()
    spawn.mockReturnValue(secondProc)
    await mgr.start({ ...CFG, token: 'tok456' })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(firstProc.kill).toHaveBeenCalledTimes(1)
    // 新 toml 覆盖
    expect(fs.readFileSync(path.join(tmpDir, 'frpc.toml'), 'utf8')).toContain('auth.token = "tok456"')
  })

  // ---------- 指数退避重启 ----------
  test('exit 后指数退避重启：1s → 2s → 4s，封顶前翻倍', () => {
    jest.useFakeTimers()
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    spawn.mockImplementation(() => makeProc()) // 每次返回新进程，避免同一 EventEmitter 重复挂 listener

    mgr.start(CFG) // 不 await（fake timers 下同步执行到第一个 spawn）
    expect(spawn).toHaveBeenCalledTimes(1)

    // 第一次退出 → 退避 1s
    spawn.mock.results[0].value.emit('exit', 1, null)
    jest.advanceTimersByTime(999)
    expect(spawn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(spawn).toHaveBeenCalledTimes(2)

    // 第二次退出 → 退避 2s
    spawn.mock.results[1].value.emit('exit', 1, null)
    jest.advanceTimersByTime(2000)
    expect(spawn).toHaveBeenCalledTimes(3)

    // 第三次退出 → 退避 4s
    spawn.mock.results[2].value.emit('exit', 1, null)
    jest.advanceTimersByTime(4000)
    expect(spawn).toHaveBeenCalledTimes(4)
  })

  test('退避封顶：超过 retryMaxMs 后保持 60s 上限', () => {
    jest.useFakeTimers()
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    spawn.mockImplementation(() => makeProc())
    mgr.start(CFG)
    // 多次退出让退避达到封顶 60s
    for (let i = 0; i < 8; i++) {
      spawn.mock.results[i].value.emit('exit', 1, null)
      jest.advanceTimersByTime(60000) // 每次都按当前退避推进足够时间
    }
    // 连续两次间隔都应为 60s（封顶）
    const t1 = jest.getTimerCount()
    spawn.mock.results[8].value.emit('exit', 1, null)
    jest.advanceTimersByTime(60000)
    expect(spawn).toHaveBeenCalledTimes(10)
    expect(jest.getTimerCount()).toBe(t1)
  })

  // ---------- stop 清理 ----------
  test('stop：kill 子进程、isRunning 变 false、spawn 不再重启', async () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    await mgr.start(CFG)
    expect(mgr.isRunning()).toBe(true)
    await mgr.stop()
    expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(mgr.isRunning()).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  test('stop 清退避：exit 触发退避定时器后 stop，定时器不再拉起进程', () => {
    jest.useFakeTimers()
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    spawn.mockImplementation(() => makeProc())
    mgr.start(CFG)
    // exit 调度了重启 timer（1s）
    spawn.mock.results[0].value.emit('exit', 1, null)
    expect(spawn).toHaveBeenCalledTimes(1)
    // 未到 1s 就 stop
    const stopP = mgr.stop()
    jest.advanceTimersByTime(10000)
    expect(spawn).toHaveBeenCalledTimes(1) // 不重启
    return stopP
  })

  test('stop 对未启动实例幂等', async () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    await expect(mgr.stop()).resolves.toEqual({ stopped: true })
    expect(spawn).not.toHaveBeenCalled()
  })

  test('getStatus 不泄露 token', async () => {
    const mgr = makeManager({ tmpDir, resourcePath, spawn })
    await mgr.start(CFG)
    const s = mgr.getStatus()
    expect(s.running).toBe(true)
    expect(s.pid).toBe(proc.pid)
    expect(s.config).toMatchObject({ serverAddr: CFG.serverAddr, localPort: CFG.localPort })
    expect(s.config.token).toBeUndefined()
  })
})
