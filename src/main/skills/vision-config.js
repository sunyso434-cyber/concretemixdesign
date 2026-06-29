/**
 * 视觉配置技能组
 * 通过对话配置/查看/清除视觉模型 API（无需修改系统设置页）
 *
 * 文件导出 3 个技能（configure_vision_model / get_vision_config / clear_vision_config），
 * SkillRegistry 会通过 _loadFromDir 自动发现并逐个注册。
 */

const { createError } = require('../agent/ErrorCodes')

/**
 * 脱敏 apiKey
 * - 保留 "sk-" 前缀（业界约定：OpenAI 风格 key 必以 sk- 起头），
 *   后接打码 + 末 4 位
 * - 长度 ≤ 8：保留前 2 + "***"
 * - 不以 sk- 起头：保留前 4 + 打码 + 末 4
 */
function maskApiKey(key) {
  if (!key) return null
  if (key.length <= 8) return key.slice(0, 2) + '***'
  if (key.startsWith('sk-')) {
    const tail = key.slice(-4)
    const middle = key.slice(3, -4) // 去掉 sk- 前缀和末 4 位后剩余部分
    return 'sk-' + '*'.repeat(Math.max(4, middle.length)) + tail
  }
  return key.slice(0, 4) + '*'.repeat(Math.max(4, key.length - 8)) + key.slice(-4)
}

const skills = [
  {
    name: 'configure_vision_model',
    description: '配置视觉模型 API（base url、api key、模型名）。视觉模型用于读取图片内容。支持任意 OpenAI Chat Completions 兼容服务（如 Qwen-VL、硅基流动、自建服务）。',
    version: '1.0.0',
    category: 'vision',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'API 基础地址（如 https://dashscope.aliyuncs.com/compatible-mode/v1）' },
        apiKey: { type: 'string', description: 'API 密钥' },
        model: { type: 'string', description: '模型名称（如 qwen-vl-plus）' },
        maxDimension: { type: 'integer', description: '图片最大边长（px），默认 1024', minimum: 256, maximum: 4096 },
        maxSizeMb: { type: 'integer', description: '最大图片大小（MB），默认 10', minimum: 1, maximum: 50 },
        enabled: { type: 'boolean', description: '是否启用，默认 true' }
      },
      required: ['baseUrl', 'apiKey', 'model']
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      await ss.saveVisionConfig({
        apiUrl: args.baseUrl,
        apiKey: args.apiKey,
        model: args.model,
        maxDimension: args.maxDimension,
        maxSizeMb: args.maxSizeMb,
        enabled: args.enabled !== false
      })
      return {
        success: true,
        message: '视觉模型配置已保存',
        config: { baseUrl: args.baseUrl, model: args.model, enabled: args.enabled !== false }
      }
    }
  },
  {
    name: 'get_vision_config',
    description: '查看当前视觉模型配置（apiKey 脱敏显示）。',
    version: '1.0.0',
    category: 'vision',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      const cfg = await ss.getVisionConfig()
      return {
        success: true,
        configured: !!(cfg.apiUrl && cfg.apiKey && cfg.model),
        enabled: cfg.enabled,
        baseUrl: cfg.apiUrl,
        apiKey: maskApiKey(cfg.apiKey),
        model: cfg.model,
        maxDimension: cfg.maxDimension,
        maxSizeMb: cfg.maxSizeMb
      }
    }
  },
  {
    name: 'clear_vision_config',
    description: '清除视觉模型配置。清除后 analyze_concrete_image 不可用。',
    version: '1.0.0',
    category: 'vision',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      await ss.clearVisionConfig()
      return { success: true, message: '视觉模型配置已清除' }
    }
  }
]

module.exports = skills
