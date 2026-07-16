/**
 * 学术搜索配置技能组
 * 通过对话配置/查看/清除学术搜索参数（无需修改系统设置页，与 web-search-config 同套路）
 *
 * 文件导出 3 个技能（configure_academic_search / get_academic_search_config / clear_academic_search_config），
 * SkillRegistry 会通过 _loadFromDir 自动发现并逐个注册。
 */

const { createError } = require('../agent/ErrorCodes')

const SUPPORTED = ['semantic_scholar', 'openalex']

const skills = [
  {
    name: 'configure_academic_search',
    description: '配置学术搜索参数（provider 搜索服务商 + arxiv 兜底开关）。学术搜索用于查询科技论文（中英文期刊、预印本）。支持 semantic_scholar（推荐，免费）/ openalex（免费）。所有 API 无需 key。老板说"学术搜索用 OpenAlex"、"禁用 arxiv 兜底"等指令时调用此技能。',
    version: '1.0.0',
    category: 'agent',
    parameters: {
      provider: {
        type: 'string',
        enum: SUPPORTED,
        required: false,
        description: '学术搜索服务商：semantic_scholar（推荐）或 openalex'
      },
      arxivFallback: {
        type: 'boolean',
        required: false,
        description: '是否启用 arxiv 预印本兜底（fetch 模式找不到全文时回退到 arxiv 搜同名预印本）'
      }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')

      // 1. 至少传一个参数
      if (args.provider === undefined && args.arxivFallback === undefined) {
        return createError(
          'PARAM_MISSING',
          '至少需要 provider 或 arxivFallback 之一',
          '例如：configure_academic_search({ provider: "openalex" }) 或 { arxivFallback: false }',
          { received: Object.keys(args || {}) }
        )
      }

      // 2. 校验 provider
      if (args.provider !== undefined && !SUPPORTED.includes(args.provider)) {
        return createError(
          'E-SEARCH-INVALID-ACADEMIC-PROVIDER',
          `不支持的学术搜索服务商: ${args.provider}`,
          `目前仅支持 ${SUPPORTED.join(' / ')}，请重新配置`,
          { received: args.provider, supported: SUPPORTED }
        )
      }

      // 3. 写入 SystemParam（任务 3 提供 ss.saveAcademicSearchConfig 方法）
      //    若方法尚未就绪则降级到内存 Map（任务 3 之前的临时实现，便于独立测试）
      try {
        if (typeof ss.saveAcademicSearchConfig === 'function') {
          await ss.saveAcademicSearchConfig({
            provider: args.provider,
            arxivFallback: args.arxivFallback
          })
        } else {
          // 任务 3 之前：内存降级
          if (!global.__academicSearchConfig) {
            global.__academicSearchConfig = { provider: 'semantic_scholar', arxivFallback: true }
          }
          if (args.provider !== undefined) global.__academicSearchConfig.provider = args.provider
          if (args.arxivFallback !== undefined) global.__academicSearchConfig.arxivFallback = args.arxivFallback
        }
      } catch (e) {
        return createError('E-SYS-999', '保存配置失败', '请稍后重试', { originalError: e.message })
      }

      // 4. 回显当前完整配置
      let current
      try {
        current = (typeof ss.getAcademicSearchConfig === 'function')
          ? await ss.getAcademicSearchConfig()
          : (global.__academicSearchConfig || { provider: 'semantic_scholar', arxivFallback: true })
      } catch (_) {
        current = { provider: args.provider || 'semantic_scholar', arxivFallback: args.arxivFallback !== false }
      }

      return {
        success: true,
        message: '学术搜索配置已保存',
        config: current
      }
    }
  },
  {
    name: 'get_academic_search_config',
    description: '查看当前学术搜索配置（provider、arxiv 兜底开关）。老板说"学术搜索现在用哪家？"、"学术搜索配置"等指令时调用此技能。',
    version: '1.0.0',
    category: 'agent',
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      let cfg
      try {
        cfg = (typeof ss.getAcademicSearchConfig === 'function')
          ? await ss.getAcademicSearchConfig()
          : (global.__academicSearchConfig || { provider: 'semantic_scholar', arxivFallback: true })
      } catch (_) {
        cfg = { provider: 'semantic_scholar', arxivFallback: true }
      }
      return { success: true, config: cfg }
    }
  },
  {
    name: 'clear_academic_search_config',
    description: '清除学术搜索配置（恢复默认：provider=semantic_scholar, arxivFallback=true）。老板说"清除学术搜索配置"、"重置学术搜索"等指令时调用此技能。',
    version: '1.0.0',
    category: 'agent',
    parameters: { type: 'object', properties: {}, required: [] },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return createError('E-SYS-999', '系统服务不可用', '请稍后重试')
      try {
        if (typeof ss.clearAcademicSearchConfig === 'function') {
          await ss.clearAcademicSearchConfig()
        } else {
          global.__academicSearchConfig = { provider: 'semantic_scholar', arxivFallback: true }
        }
      } catch (e) {
        return createError('E-SYS-999', '清除配置失败', '请稍后重试', { originalError: e.message })
      }
      return { success: true, message: '学术搜索配置已恢复默认', config: { provider: 'semantic_scholar', arxivFallback: true } }
    }
  }
]

module.exports = skills