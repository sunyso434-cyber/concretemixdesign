'use strict'

// RemoteAuth 单元测试：配对码 / 登录 / 设备注册表持久化 / 限流 / 密码重置
// 持久化测试全部使用独立临时 userDataDir（os.tmpdir 下 mkdtemp），避免污染真实数据；
// SecurityLog 落库复用 tests/jest.setup.js 指向的临时 USER_DATA_PATH sqlite 库。
const fs = require('fs')
const os = require('os')
const path = require('path')
const RemoteAuth = require('../RemoteAuth')
const { SecurityLog: SecurityLogModel, sequelize } = require('../../db/database')

// 生成一个独立的临时 userDataDir（模拟一台"机器"的 userData）
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remoteauth-'))
}

describe('RemoteAuth（远程认证：配对 / 登录 / 设备注册表持久化）', () => {
  let tmpDir

  beforeAll(async () => {
    // 建 security_logs 表（在 jest.setup.js 指定的临时 USER_DATA_PATH 下）
    await SecurityLogModel.sync()
  })

  beforeEach(async () => {
    await SecurityLogModel.destroy({ truncate: true })
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  // 新建一个已 init 到临时目录的实例；同时记录 tmpDir 供 afterEach 清理
  function newAuth(options) {
    tmpDir = makeTmpDir()
    const auth = new RemoteAuth(options)
    auth.init({ userDataDir: tmpDir })
    return auth
  }

  // ---- 配对码 ----

  test('generatePairCode 生成 8 位字母数字码，带过期时间与 addr 占位', () => {
    const auth = newAuth()
    const r = auth.generatePairCode()
    expect(r.code).toMatch(/^[A-Z2-9]{8}$/)
    expect(r.expiresAt).toBeGreaterThan(Date.now())
    expect(r).toHaveProperty('addr')
  })

  test('配对码一次性：用后即焚，重复使用被拒绝', async () => {
    const auth = newAuth()
    const { code } = auth.generatePairCode()

    const r1 = await auth.pair({ code })
    expect(r1.ok).toBe(true)
    expect(r1.deviceId).toMatch(/^dev_[0-9a-f]{16}$/)

    const r2 = await auth.pair({ code })
    expect(r2.ok).toBe(false)
    expect(r2.error).toBe('INVALID_CODE')
  })

  test('配对码限时：过期后无法配对', async () => {
    const auth = newAuth({ pairCodeTtlMs: 50 })
    const { code } = auth.generatePairCode()
    await new Promise(r => setTimeout(r, 80))
    const res = await auth.pair({ code })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('CODE_EXPIRED')
  })

  test('配对成功：设备写入 remote-devices.json 注册表 + 写 remote.pair 安全日志', async () => {
    const auth = newAuth()
    const { code } = auth.generatePairCode()
    const { ok, deviceId } = await auth.pair({ code })
    expect(ok).toBe(true)

    // 设备注册表持久化文件
    const devicesPath = path.join(tmpDir, 'remote-devices.json')
    expect(fs.existsSync(devicesPath)).toBe(true)
    const data = JSON.parse(fs.readFileSync(devicesPath, 'utf8'))
    expect(data.devices[deviceId].deviceId).toBe(deviceId)
    expect(data.devices[deviceId].pairedAt).toBeDefined()

    // 安全日志
    const rows = await SecurityLogModel.findAll({ order: [['id', 'ASC']] })
    const pairRow = rows.find(r => r.event === 'remote.pair')
    expect(pairRow).toBeDefined()
    expect(pairRow.deviceId).toBe(deviceId)
    expect(pairRow.origin).toBe('remote')
    expect(pairRow.ok).toBe(true)
  })

  test('配对失败：写 ok=false 的安全日志', async () => {
    const auth = newAuth()
    await auth.pair({ code: 'WRONGCODE' })
    const row = await SecurityLogModel.findOne({ where: { event: 'remote.pair', ok: false } })
    expect(row).toBeDefined()
  })

  // ---- 密码与开关 ----

  test('setPassword 存 SHA256 hash，不存明文；setEnabled/isEnabled 持久化到 remote-auth.json', () => {
    const auth = newAuth()
    expect(auth.isEnabled()).toBe(false)

    auth.setPassword('secret123')
    auth.setEnabled(true)
    expect(auth.isEnabled()).toBe(true)

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'remote-auth.json'), 'utf8'))
    expect(data.passwordHash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.passwordHash).not.toContain('secret123')
    expect(data.enabled).toBe(true)
  })

  test('generateRandomPassword 生成两次不同的非空随机密码', () => {
    const auth = new RemoteAuth()
    const a = auth.generateRandomPassword()
    const b = auth.generateRandomPassword()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
  })

  // ---- 登录 ----

  test('登录：密码正确 + 设备已配对 → 返回 token，verifyToken 识别该 deviceId', async () => {
    const auth = newAuth()
    auth.setPassword('abc123')
    auth.setEnabled(true)
    const { code } = auth.generatePairCode()
    const { deviceId } = await auth.pair({ code })

    const res = await auth.login({ password: 'abc123', deviceId })
    expect(res.ok).toBe(true)
    expect(res.token).toMatch(/^[0-9a-f]{64}$/)
    expect(res.deviceId).toBe(deviceId)

    const vt = auth.verifyToken(res.token)
    expect(vt.ok).toBe(true)
    expect(vt.deviceId).toBe(deviceId)

    // 登录成功写安全日志
    const row = await SecurityLogModel.findOne({ where: { event: 'auth.login', ok: true } })
    expect(row).toBeDefined()
    expect(row.deviceId).toBe(deviceId)
  })

  test('设备授权强制：未配对设备即使密码正确也被拒绝（P2-1）', async () => {
    const auth = newAuth()
    auth.setPassword('abc123')
    auth.setEnabled(true)
    const { code } = auth.generatePairCode()
    await auth.pair({ code }) // 先正常配对一台设备

    const res = await auth.login({ password: 'abc123', deviceId: 'dev_hacker_never_paired' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('DEVICE_NOT_PAIRED')
  })

  test('远程认证未启用时拒绝登录', async () => {
    const auth = newAuth()
    auth.setPassword('abc123') // 故意不 setEnabled(true)
    const { code } = auth.generatePairCode()
    const { deviceId } = await auth.pair({ code })

    const res = await auth.login({ password: 'abc123', deviceId })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('DISABLED')
  })

  test('限流：连续失败 5 次锁 10 分钟，锁定期内正确密码也拒绝', async () => {
    const auth = newAuth()
    auth.setPassword('right-pw')
    auth.setEnabled(true)
    const { code } = auth.generatePairCode()
    const { deviceId } = await auth.pair({ code })

    for (let i = 1; i <= 5; i++) {
      const r = await auth.login({ password: 'wrong-pw', deviceId })
      expect(r.ok).toBe(false)
      expect(r.error).toBe('WRONG_PASSWORD')
    }

    // 第 6 次（正确密码）仍被锁
    const locked = await auth.login({ password: 'right-pw', deviceId })
    expect(locked.ok).toBe(false)
    expect(locked.error).toBe('LOCKED')
    expect(locked.retryAfterMs).toBeGreaterThan(0)
  })

  test('锁定到期后自动解锁，正确密码可登录', async () => {
    const auth = newAuth({ maxLoginFailures: 2, lockoutMs: 60 })
    auth.setPassword('right-pw')
    auth.setEnabled(true)
    const { code } = auth.generatePairCode()
    const { deviceId } = await auth.pair({ code })

    await auth.login({ password: 'no', deviceId })
    await auth.login({ password: 'no', deviceId })
    const locked = await auth.login({ password: 'right-pw', deviceId })
    expect(locked.error).toBe('LOCKED')

    await new Promise(r => setTimeout(r, 90))
    const ok = await auth.login({ password: 'right-pw', deviceId })
    expect(ok.ok).toBe(true)
  })

  test('token 限时：过期后失效', async () => {
    const auth = newAuth({ tokenTtlMs: 50 })
    auth.setPassword('abc123')
    auth.setEnabled(true)
    const { code } = auth.generatePairCode()
    const { deviceId } = await auth.pair({ code })
    const { token } = await auth.login({ password: 'abc123', deviceId })

    expect(auth.verifyToken(token).ok).toBe(true)
    await new Promise(r => setTimeout(r, 80))
    expect(auth.verifyToken(token).ok).toBe(false)
  })

  test('verifyToken 对无效/空 token 返回 ok=false', () => {
    const auth = newAuth()
    expect(auth.verifyToken('nope').ok).toBe(false)
    expect(auth.verifyToken(null).ok).toBe(false)
    expect(auth.verifyToken(undefined).ok).toBe(false)
  })

  // ---- 设备注册表持久化 / 密码重置 ----

  test('设备注册表持久化：重启（重新 init）后设备仍被识别，可重新登录并签发新 token', async () => {
    const dir = makeTmpDir()
    tmpDir = dir

    // 第一次"运行"
    const auth1 = new RemoteAuth()
    auth1.init({ userDataDir: dir })
    auth1.setPassword('abc123')
    auth1.setEnabled(true)
    const { code } = auth1.generatePairCode()
    const { deviceId } = await auth1.pair({ code })
    expect(deviceId).toBeTruthy()

    // 模拟重启：全新实例，相同 userDataDir
    const auth2 = new RemoteAuth()
    auth2.init({ userDataDir: dir })

    // 注册表持久化：无需重新配对，deviceId 仍被识别，密码登录成功
    const res = await auth2.login({ password: 'abc123', deviceId })
    expect(res.ok).toBe(true)
    expect(res.token).toBeTruthy()

    // 新 token 绑定该 deviceId
    const vt = auth2.verifyToken(res.token)
    expect(vt.ok).toBe(true)
    expect(vt.deviceId).toBe(deviceId)

    // 新实例下未配对设备依旧被拒
    const denied = await auth2.login({ password: 'abc123', deviceId: 'dev_not_paired' })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('DEVICE_NOT_PAIRED')
  })

  test('重置密码后旧密码失效，新密码可登录', async () => {
    const auth = newAuth()
    auth.setPassword('old-pw')
    auth.setEnabled(true)
    const { code } = auth.generatePairCode()
    const { deviceId } = await auth.pair({ code })

    const ok1 = await auth.login({ password: 'old-pw', deviceId })
    expect(ok1.ok).toBe(true)

    auth.setPassword('new-pw')
    const oldPw = await auth.login({ password: 'old-pw', deviceId })
    expect(oldPw.ok).toBe(false)
    expect(oldPw.error).toBe('WRONG_PASSWORD')

    const newPw = await auth.login({ password: 'new-pw', deviceId })
    expect(newPw.ok).toBe(true)
  })
})
