'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const SecurityLog = require('./SecurityLog')

// ============================================================
// RemoteAuth：远程认证模块（扫码配对 + 登录 + 设备注册表持久化）
//
// 纯 Node 实现，不 require electron：
//   - 存储路径由调用方 init({ userDataDir }) 注入（Electron 侧传 app.getPath('userData')）
//   - 密码 / 开关 → <userData>/remote-auth.json    （SHA256 hash + enabled）
//   - 设备注册表   → <userData>/remote-devices.json（deviceId + pairedAt，持久化）
//   - 配对码 / token / 限流计数 → 内存（重启即失效；token 24h）
// 所有成败路径都写 SecurityLog（origin='remote'），但日志写库失败不阻断认证流程。
// ============================================================

const PAIR_CODE_TTL = 5 * 60 * 1000        // 配对码有效期 5 分钟
const TOKEN_TTL = 24 * 60 * 60 * 1000      // token 有效期 24 小时
const MAX_LOGIN_FAILURES = 5               // 连续失败 5 次
const LOCKOUT_MS = 10 * 60 * 1000          // 锁定 10 分钟
const PAIR_CODE_LENGTH = 8
const DEFAULT_PASSWORD_LENGTH = 12
// 配对码字符集：去掉易混淆的 0/O/1/I，便于扫码枪/手工输入
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
// 随机密码字符集：大小写字母 + 数字（保留可读性，面板展示后手工输入）
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

class RemoteAuth {
  /**
   * @param {object} [options] 测试用可调参数，生产走默认值
   * @param {number} [options.pairCodeTtlMs]  配对码有效期（默认 5 分钟）
   * @param {number} [options.tokenTtlMs]     token 有效期（默认 24 小时）
   * @param {number} [options.maxLoginFailures] 连续失败锁定阈值（默认 5）
   * @param {number} [options.lockoutMs]      锁定时间（默认 10 分钟）
   */
  constructor(options = {}) {
    this._pairCodeTtlMs = options.pairCodeTtlMs || PAIR_CODE_TTL
    this._tokenTtlMs = options.tokenTtlMs || TOKEN_TTL
    this._maxLoginFailures = options.maxLoginFailures || MAX_LOGIN_FAILURES
    this._lockoutMs = options.lockoutMs || LOCKOUT_MS

    this._userDataDir = null
    this._pairCodes = new Map()      // code -> { expiresAt, used }
    this._tokens = new Map()         // token -> { deviceId, expiresAt }
    this._loginFailures = new Map()  // deviceId -> { count, lockedUntil }
    this._devices = new Map()        // deviceId -> { deviceId, pairedAt }
    this._passwordHash = null
    this._enabled = false
  }

  // ---------- 初始化 ----------

  /**
   * 初始化存储路径并加载持久化数据。
   * @param {{ userDataDir: string }} param
   */
  init({ userDataDir }) {
    if (!userDataDir) throw new Error('RemoteAuth.init 需要 userDataDir')
    this._userDataDir = userDataDir
    fs.mkdirSync(userDataDir, { recursive: true })
    this._loadAuthFile()
    this._loadDevices()
  }

  // ---------- 密码与开关 ----------

  /** 设置远程登录密码，存 SHA256 hash（覆盖旧密码，旧密码立即失效）。 */
  setPassword(pw) {
    const s = String(pw == null ? '' : pw)
    if (!s.length) throw new Error('密码不能为空')
    this._passwordHash = this._hashPassword(s)
    this._saveAuthFile()
  }

  /** 远程认证开关是否启用。 */
  isEnabled() {
    return this._enabled
  }

  /** 启用/停用远程认证，持久化到 remote-auth.json。 */
  setEnabled(v) {
    this._enabled = !!v
    this._saveAuthFile()
    return this._enabled
  }

  /** 生成一个随机密码（面板首次启用时一次性展示，再交由 setPassword 保存）。 */
  generateRandomPassword(length = DEFAULT_PASSWORD_LENGTH) {
    return randomFromChars(PW_CHARS, length)
  }

  // ---------- 配对 ----------

  /**
   * 生成一次性配对码（内存，5 分钟有效）。
   * @returns {{ code: string, expiresAt: number, addr: string|null }} addr 由 RemoteServer(R5) 注入，本模块置空
   */
  generatePairCode() {
    this._purgeExpiredPairCodes()
    let code
    do {
      code = randomFromChars(CODE_CHARS, PAIR_CODE_LENGTH)
    } while (this._pairCodes.has(code))
    const expiresAt = Date.now() + this._pairCodeTtlMs
    this._pairCodes.set(code, { expiresAt, used: false })
    return { code, expiresAt, addr: null }
  }

  /**
   * 用配对码完成配对：校验通过后生成 deviceId 并写入设备注册表（持久化）。
   * @returns {Promise<{ ok: boolean, deviceId?: string, error?: string }>}
   */
  async pair({ code }) {
    const entry = this._pairCodes.get(code)
    const now = Date.now()

    if (!entry || entry.used) {
      await this._log('remote.pair', 'unknown', '配对码无效或已使用', false)
      return { ok: false, error: 'INVALID_CODE' }
    }
    if (entry.expiresAt <= now) {
      this._pairCodes.delete(code)
      await this._log('remote.pair', 'unknown', '配对码已过期', false)
      return { ok: false, error: 'CODE_EXPIRED' }
    }

    // 一次性：用后即焚
    entry.used = true
    this._pairCodes.delete(code)

    const deviceId = 'dev_' + crypto.randomBytes(8).toString('hex')
    this._devices.set(deviceId, { deviceId, pairedAt: new Date().toISOString() })
    this._saveDevices()

    await this._log('remote.pair', deviceId, '配对成功', true)
    return { ok: true, deviceId }
  }

  // ---------- 登录 ----------

  /**
   * 设备 + 密码校验后签发内存 token（绑定 deviceId，24h）。
   * 强制校验设备注册表：未配对设备即使密码正确也拒绝（P2-1）。
   * @returns {Promise<{ ok: boolean, token?: string, deviceId?: string, error?: string, retryAfterMs?: number, attemptsLeft?: number }>}
   */
  async login({ password, deviceId }) {
    if (!this._enabled) {
      await this._log('auth.login', deviceId || 'unknown', '远程认证未启用', false)
      return { ok: false, error: 'DISABLED' }
    }

    // P2-1 设备授权强制：未配对设备直接拒绝（不消耗失败计数，无身份可锁）
    if (!deviceId || !this._devices.has(deviceId)) {
      await this._log('auth.login', deviceId || 'unknown', '设备未配对，拒绝登录', false)
      return { ok: false, error: 'DEVICE_NOT_PAIRED' }
    }

    // 限流：锁定期内一律拒绝
    const now = Date.now()
    let fl = this._loginFailures.get(deviceId)
    if (fl && fl.lockedUntil && fl.lockedUntil > now) {
      await this._log('auth.login', deviceId, '连续失败已被锁定', false)
      return { ok: false, error: 'LOCKED', retryAfterMs: fl.lockedUntil - now }
    }
    if (fl && fl.lockedUntil && fl.lockedUntil <= now) {
      // 锁定期已过，清除旧记录，重新计数
      this._loginFailures.delete(deviceId)
      fl = null
    }

    if (!this._passwordHash || this._hashPassword(password) !== this._passwordHash) {
      const count = (fl ? fl.count : 0) + 1
      if (count >= this._maxLoginFailures) {
        this._loginFailures.set(deviceId, { count: 0, lockedUntil: now + this._lockoutMs })
      } else {
        this._loginFailures.set(deviceId, { count, lockedUntil: null })
      }
      await this._log('auth.login', deviceId, `密码错误（第 ${count} 次）`, false)
      return {
        ok: false,
        error: 'WRONG_PASSWORD',
        attemptsLeft: Math.max(0, this._maxLoginFailures - count)
      }
    }

    // 登录成功：清失败计数，签发内存 token（绑定 deviceId，24h）
    this._loginFailures.delete(deviceId)
    const token = crypto.randomBytes(32).toString('hex')
    this._tokens.set(token, { deviceId, expiresAt: now + this._tokenTtlMs })
    await this._log('auth.login', deviceId, '登录成功', true)
    return { ok: true, token, deviceId }
  }

  // ---------- token ----------

  /**
   * 校验内存 token。token 未过期且存在则返回绑定的 deviceId。
   * @returns {{ ok: boolean, deviceId?: string }}
   */
  verifyToken(token) {
    if (!token) return { ok: false }
    this._purgeExpiredTokens()
    const t = this._tokens.get(token)
    if (!t) return { ok: false }
    if (t.expiresAt <= Date.now()) {
      this._tokens.delete(token)
      return { ok: false }
    }
    return { ok: true, deviceId: t.deviceId }
  }

  // ---------- 私有：持久化 ----------

  _authFilePath() {
    this._requireInit()
    return path.join(this._userDataDir, 'remote-auth.json')
  }

  _devicesFilePath() {
    this._requireInit()
    return path.join(this._userDataDir, 'remote-devices.json')
  }

  _requireInit() {
    if (!this._userDataDir) throw new Error('RemoteAuth 未 init：请先调用 init({ userDataDir })')
  }

  _loadAuthFile() {
    try {
      const data = JSON.parse(fs.readFileSync(this._authFilePath(), 'utf8'))
      this._passwordHash = data.passwordHash || null
      this._enabled = !!data.enabled
    } catch {
      this._passwordHash = null
      this._enabled = false
    }
  }

  _saveAuthFile() {
    this._atomicWrite(
      this._authFilePath(),
      JSON.stringify({ passwordHash: this._passwordHash, enabled: this._enabled })
    )
  }

  _loadDevices() {
    try {
      const data = JSON.parse(fs.readFileSync(this._devicesFilePath(), 'utf8'))
      this._devices = new Map()
      for (const [id, d] of Object.entries(data.devices || {})) {
        this._devices.set(id, d)
      }
    } catch {
      this._devices = new Map()
    }
  }

  _saveDevices() {
    const devices = {}
    for (const [id, d] of this._devices) devices[id] = d
    this._atomicWrite(this._devicesFilePath(), JSON.stringify({ devices }))
  }

  // 临时文件 + rename 原子写：进程崩溃时避免写坏注册表/密码文件
  _atomicWrite(filePath, data) {
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, data)
    fs.renameSync(tmpPath, filePath)
  }

  // ---------- 私有：内存清理 ----------

  _purgeExpiredPairCodes() {
    const now = Date.now()
    for (const [code, entry] of this._pairCodes) {
      if (entry.expiresAt <= now) this._pairCodes.delete(code)
    }
  }

  _purgeExpiredTokens() {
    const now = Date.now()
    for (const [token, t] of this._tokens) {
      if (t.expiresAt <= now) this._tokens.delete(token)
    }
  }

  // ---------- 私有：杂项 ----------

  _hashPassword(pw) {
    return crypto.createHash('sha256').update(String(pw)).digest('hex')
  }

  // 安全日志写库失败不阻断认证流程（如数据库临时不可用）
  async _log(event, deviceId, detail, ok) {
    try {
      await SecurityLog.record({ event, deviceId, detail, origin: 'remote', ok })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[RemoteAuth] 安全日志写入失败: ${err && err.message ? err.message : err}`)
    }
  }
}

// 从字符集随机取 length 位（用 randomBytes 的模运算避免多次调用熵源）
function randomFromChars(chars, length) {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length]
  return out
}

module.exports = RemoteAuth
