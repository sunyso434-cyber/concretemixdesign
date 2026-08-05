/**
 * 联网搜索配置技能组
 * 通过对话配置/查看/清除联网搜索 API（无需修改系统设置页，与 vision-config 同套路）
 *
 * 文件导出 3 个技能（configure_web_search / get_web_search_config / clear_web_search_config），
 * SkillRegistry 会通过 _loadFromDir 自动发现并逐个注册。
 */

const { createError } = require('../agent/ErrorCodes')

const SUPPORTED = ['bocha', 'tavily']

/** 脱敏 apiKey（与 vision-config 一致） */
function maskApiKey(key) {
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
    name: 'configure_web_search',
    description: '配置联网搜索 API（服务商 provider + api key）。联网搜索用于查询最新资料（规范条文、材料参数、行情等）。支持 bocha（博查，国内免费源）/ tavily（海外）。',
    version: '1.0.0',
    category: 'agent',
    isWrite: true,
    parameters: {
      provider: { type: 'string', description: '搜索服务商：bocha（推荐，国内免费）或 tavily', required: true, enum: SUPPORTED },
      apiKey: { type: 'string', description: 'API 密钥', required: true },
      enabled: { type: 'boolean', description: '是否启用，默认 true', required: false }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')

      const missing = []
      if (!args.provider || typeof args.provider !== 'string') missing.push('provider')
      if (!args.apiKey || typeof args.apiKey !== 'string') missing.push('apiKey')
      if (missing.length > 0) {
        return createError('PARAM_MISSING', `缺少必填参数: ${missing.join(', ')}`,
          '请提供 provider（bocha/tavily）和 apiKey 后重试', { missing, received: Object.keys(args || {}) })
      }
      if (!SUPPORTED.includes(args.provider)) {
        return createError('E-SEARCH-INVALID-PROVIDER', `不支持的服务商: ${args.provider}`,
          `目前仅支持 ${SUPPORTED.join(' / ')}`, { received: args.provider, supported: SUPPORTED })
      }

      await ss.saveWebSearchConfig({
        provider: args.provider,
        apiKey: args.apiKey,
        enabled: args.enabled !== false
      })
      return {
        success: true,
        message: '联网搜索配置已保存',
        config: { provider: args.provider, enabled: args.enabled !== false }
      }
    }
  },
  {
    name: 'get_web_search_config',
    description: '查看当前联网搜索配置（apiKey 脱敏显示）。',
    version: '1.0.0',
    category: 'agent',
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      const cfg = await ss.getWebSearchConfig()
      return {
        success: true,
        configured: !!(cfg.apiKey),
        enabled: cfg.enabled,
        provider: cfg.provider,
        apiKey: maskApiKey(cfg.apiKey)
      }
    }
  },
  {
    name: 'clear_web_search_config',
    description: '清除联网搜索配置。清除后 web_search 不可用。',
    version: '1.0.0',
    category: 'agent',
    isWrite: true,
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      await ss.clearWebSearchConfig()
      return { success: true, message: '联网搜索配置已清除' }
    }
  }
]

module.exports = skills
