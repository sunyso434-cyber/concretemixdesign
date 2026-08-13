/**
 * 网页抓取配置技能组
 * 通过对话配置/查看/清除 web_fetch 的 provider（无需修改系统设置页，与 web-search-config 同套路）
 *
 * 文件导出 3 个技能（configure_web_fetch / get_web_fetch_config / clear_web_fetch_config），
 * SkillRegistry 会通过 _loadFromDir 自动发现并逐个注册。
 *
 * 设计要点：
 * - web_fetch 不单独存 key，tinyfish 复用 web_search 的 apiKey（两能力共用同一 key）
 * - provider 三选一：auto（默认，按 web_search 配置自动选）/ jina（免 key 兜底）/ tinyfish（需 web_search 配 tinyfish key）
 */

const { createError } = require('../agent/ErrorCodes')

const SUPPORTED_PROVIDERS = ['auto', 'jina', 'tinyfish']

const skills = [
  {
    name: 'configure_web_fetch',
    description: '配置网页抓取 provider（auto/jina/tinyfish）。web_fetch 用于抓取网页完整正文。auto（推荐）：web_search 配了 tinyfish 就用 tinyfish，否则用 jina；jina：免 key 免费兜底；tinyfish：需先配 web_search 的 tinyfish key。注意：tinyfish 的 key 与 web_search 共用，不在这里单独配 key。',
    version: '1.0.0',
    category: 'agent',
    isWrite: true,
    parameters: {
      provider: {
        type: 'string',
        description: '抓取服务商：auto（默认，推荐）/ jina（免 key）/ tinyfish（需 web_search 配 tinyfish key）',
        required: true,
        enum: SUPPORTED_PROVIDERS
      },
      enabled: { type: 'boolean', description: '是否启用，默认 true', required: false }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')

      if (!args.provider || typeof args.provider !== 'string') {
        return createError('PARAM_MISSING', '缺少必填参数: provider',
          '请提供 provider（auto/jina/tinyfish）后重试', { missing: ['provider'], received: Object.keys(args || {}) })
      }
      if (!SUPPORTED_PROVIDERS.includes(args.provider)) {
        return createError('E-SEARCH-INVALID-PROVIDER', `不支持的抓取服务商: ${args.provider}`,
          `目前仅支持 ${SUPPORTED_PROVIDERS.join(' / ')}`, { received: args.provider, supported: SUPPORTED_PROVIDERS })
      }

      await ss.saveWebFetchConfig({
        provider: args.provider,
        enabled: args.enabled !== false
      })
      return {
        success: true,
        message: '网页抓取配置已保存',
        config: { provider: args.provider, enabled: args.enabled !== false }
      }
    }
  },
  {
    name: 'get_web_fetch_config',
    description: '查看当前网页抓取配置。',
    version: '1.0.0',
    category: 'agent',
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      const cfg = await ss.getWebFetchConfig()
      return {
        success: true,
        enabled: cfg.enabled,
        provider: cfg.provider
      }
    }
  },
  {
    name: 'clear_web_fetch_config',
    description: '清除网页抓取配置（恢复默认：provider=auto, enabled=true）。',
    version: '1.0.0',
    category: 'agent',
    isWrite: true,
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      await ss.clearWebFetchConfig()
      return { success: true, message: '网页抓取配置已恢复默认（provider=auto, enabled=true）' }
    }
  }
]

module.exports = skills
