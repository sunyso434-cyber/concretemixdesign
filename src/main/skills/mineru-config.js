/**
 * MinerU 配置技能组（v0.7.0）
 * 通过对话配置/查看/清除 MinerU 用户个人 Token（与 web-search-config 同套路）
 *
 * 文件导出 3 个技能（configure_mineru / get_mineru_config / clear_mineru_config），
 * SkillRegistry 会通过 _loadFromDir 自动发现并逐个注册。
 *
 * 说明：仅管理用户个人 Token；内置 Token 由 mineruBuiltinToken.js 提供，不可通过此 skill 修改。
 * 用户配置个人 Token 后优先使用个人 Token（避开共享额度池）。
 */

const { createError } = require('../agent/ErrorCodes')
const { hasBuiltinToken } = require('../services/mineruBuiltinToken')

/** 脱敏 Token（与 web-search-config.maskApiKey 一致） */
function maskToken(key) {
  if (!key) return null
  if (key.length <= 8) return key.slice(0, 2) + '***'
  if (key.startsWith('sk-')) {
    const tail = key.slice(-4)
    const middle = key.slice(3, -4)
    return 'sk-' + '*'.repeat(Math.max(4, middle.length)) + tail
  }
  return key.slice(0, 4) + '*'.repeat(Math.max(4, key.length - 8)) + key.slice(-4)
}

const skills = [
  {
    name: 'configure_mineru',
    description: '配置 MinerU 个人 Token（用于高精度云端文档解析）。用户可到 mineru.net 注册获取自己的 Token，配置后优先使用个人 Token（避开砼智内置 Token 的共享额度池）。',
    version: '1.0.0',
    category: 'agent',
    isWrite: true,
    parameters: {
      token: { type: 'string', description: 'MinerU API Token（sk- 开头，到 mineru.net 获取）', required: true }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      if (!args.token || typeof args.token !== 'string') {
        return createError('PARAM_MISSING', '缺少 token 参数', '请提供 mineru Token（sk- 开头）', { missing: ['token'] })
      }
      await ss.saveMineruConfig({ userToken: args.token })
      return {
        success: true,
        message: 'MinerU 个人 Token 已保存，后续解析将优先使用个人 Token',
        tokenMasked: maskToken(args.token)
      }
    }
  },
  {
    name: 'get_mineru_config',
    description: '查看当前 MinerU 配置（个人 Token 脱敏显示，并提示是否有内置 Token 可用）。',
    version: '1.0.0',
    category: 'agent',
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      const cfg = await ss.getMineruConfig()
      return {
        success: true,
        userTokenConfigured: !!cfg.userToken,
        userTokenMasked: maskToken(cfg.userToken),
        builtinTokenAvailable: hasBuiltinToken(),
        activeToken: cfg.userToken ? 'user' : (hasBuiltinToken() ? 'builtin' : 'none')
      }
    }
  },
  {
    name: 'clear_mineru_config',
    description: '清除 MinerU 个人 Token。清除后回退到砼智内置 Token（共享额度池）。',
    version: '1.0.0',
    category: 'agent',
    isWrite: true,
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      await ss.clearMineruConfig()
      return {
        success: true,
        message: 'MinerU 个人 Token 已清除，将回退到内置 Token（如有）',
        builtinTokenAvailable: hasBuiltinToken()
      }
    }
  }
]

module.exports = skills
