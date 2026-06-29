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
    version: '1.1.0',
    category: 'vision',
    // v9.1.0 修复：改用 flat schema（顶层直接是字段定义）。
    // - 旧版用 JSON Schema 嵌套格式（type/properties/required），但项目其他 skill 全用 flat 格式，
    //   导致 SchemaValidator 对该 skill 校验完全 bypass，LLM 漏传 baseUrl/apiKey/model 时仍返回 success:true
    //   实际写入时 args.baseUrl/apiKey/model 全是 undefined，只 enabled 写入
    // - 扁平化后 LLM 看到的 schema 更标准，SchemaValidator 也能正确校验必填
    parameters: {
      baseUrl: { type: 'string', description: 'API 基础地址（如 https://dashscope.aliyuncs.com/compatible-mode/v1）', required: true },
      apiKey: { type: 'string', description: 'API 密钥', required: true },
      model: { type: 'string', description: '模型名称（如 qwen-vl-plus）', required: true },
      maxDimension: { type: 'integer', description: '图片最大边长（px），默认 1024', min: 256, max: 4096, required: false },
      maxSizeMb: { type: 'integer', description: '最大图片大小（MB），默认 10', min: 1, max: 50, required: false },
      enabled: { type: 'boolean', description: '是否启用，默认 true', required: false }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')

      // v9.1.0 防御：手动校验必填非空（即使 SchemaValidator bypass 也不写入空值）
      // - SchemaValidator 现在已能校验嵌套 schema，但 LLM 可能传嵌套 JSON Schema 格式参数
      //   （如 { type, properties, required }），这里二次校验 baseUrl/apiKey/model 必须是真实字符串
      const missing = []
      if (!args.baseUrl || typeof args.baseUrl !== 'string') missing.push('baseUrl')
      if (!args.apiKey || typeof args.apiKey !== 'string') missing.push('apiKey')
      if (!args.model || typeof args.model !== 'string') missing.push('model')
      if (missing.length > 0) {
        return createError(
          'E-PARAM-MISSING',
          `缺少必填参数: ${missing.join(', ')}`,
          '请提供视觉模型的 baseUrl / apiKey / model 后重试',
          { missing, received: Object.keys(args || {}) }
        )
      }

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
