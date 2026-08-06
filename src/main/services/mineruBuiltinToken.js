/**
 * MinerU 内置 Token（v0.7.0）
 *
 * 安全说明（老板已接受风险）：
 * - Token 用 AES-256-CBC 加密存放，防肉眼可见
 * - 密钥派生串与密文都在源码里，反编译可解密 → 接受"被盗风险"
 * - 全用户共享此 Token 的额度池（5000 文件/天 + 1000 优先页/天）
 * - 用户可在设置中配置个人 Token 覆盖内置 Token
 *
 * 占位符模式：若 CIPHER 为空字符串，getBuiltinToken() 返回 null
 * （开发期未注入 Token 时使用，mineru 功能不可用但不崩溃）
 */

const crypto = require('crypto')

const ALGO = 'aes-256-cbc'
// 固定密钥派生串（防肉眼，不防反编译）
const KEY = crypto.createHash('sha256').update('tongzhi-mineru-builtin-token-v0.7.0').digest()
const IV = Buffer.from('4615905ec953249c4993d501618d92de', 'hex')
// 加密后的 Token 密文（hex）
const CIPHER = 'ccd23ae1e274f421bd90c26833e5b4831ed67f8b8cc1cf166a266b288ff9a0090d36fa2d83f09db853440cc223dcff2f62b962fdd8abdc54bc94be996e877797'

let _cached = undefined // undefined=未解析, null=解析失败, string=Token

/**
 * 获取内置 MinerU Token
 * @returns {string|null} Token 字符串；未注入（占位符）返回 null
 */
function getBuiltinToken() {
  if (_cached !== undefined) return _cached
  if (!CIPHER) {
    _cached = null
    return null
  }
  try {
    const decipher = crypto.createDecipheriv(ALGO, KEY, IV)
    let dec = decipher.update(CIPHER, 'hex', 'utf8')
    dec += decipher.final('utf8')
    _cached = dec
    return dec
  } catch (e) {
    _cached = null
    return null
  }
}

/**
 * 是否有可用的内置 Token
 * @returns {boolean}
 */
function hasBuiltinToken() {
  return getBuiltinToken() !== null
}

module.exports = { getBuiltinToken, hasBuiltinToken }
