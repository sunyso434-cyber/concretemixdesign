/**
 * 联网搜索核心技能 - web_search
 *
 * 单一职责：调第三方搜索 API，返回结果列表（标题/URL/摘要），供 Agent 提炼答案。
 * 不抓网页正文（如需正文，后续可加 web_fetch 技能）。
 */

const { createError } = require('../agent/ErrorCodes')
const WebSearchService = require('../services/WebSearchService')

/** 把 createError 结果补上 errorCode 别名（与 analyze-concrete-image 一致） */
function withErrorCodeAlias(err) {
  if (err && err.code && !err.errorCode) {
    return { ...err, errorCode: err.code }
  }
  return err
}

const skills = [
  {
    name: 'web_search',
    description: '联网搜索最新资料（规范条文、材料参数、行情等时效性信息），返回标题/URL/摘要列表。仅当工作区 wiki 知识不足以回答时才调用，不要每轮都搜。',
    version: '1.0.0',
    category: 'agent',
    parameters: {
      query: { type: 'string', description: '搜索关键词（1-200 字）', required: true },
      count: { type: 'integer', description: '返回条数，1-10，默认 5', required: false, min: 1, max: 10 }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return withErrorCodeAlias(createError('E-SYS-999', '系统服务不可用', '请稍后重试'))

      // 1. 校验 query
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) {
        return withErrorCodeAlias(createError('E-SEARCH-INVALID-QUERY', 'query 不能为空', '请提供搜索关键词'))
      }
      if (query.length > 200) {
        return withErrorCodeAlias(createError('E-SEARCH-INVALID-QUERY', 'query 过长（>200 字符）', '请缩短搜索关键词'))
      }

      // 2. 读配置（未配置 → 引导 configure_web_search）
      let cfg = null
      try {
        cfg = await ss.getWebSearchConfig()
      } catch (_) { /* ignore */ }
      if (!cfg || !cfg.enabled || !cfg.apiKey) {
        return withErrorCodeAlias(createError(
          'E-SEARCH-NOT-CONFIGURED',
          '联网搜索未配置或未启用',
          '请先说「配置联网搜索，服务商 bocha，api key 是 xxx」调用 configure_web_search',
          { hint: 'configure_web_search' }
        ))
      }

      // 3. 每次执行都用最新 cfg 构造 service（避免 ctx 复用实例配置陈旧）
      const svc = new WebSearchService({ provider: cfg.provider, apiKey: cfg.apiKey })
      try {
        const results = await svc.search(query, args.count || 5)
        return {
          success: true,
          query,
          provider: cfg.provider,
          results,
          total: results.length
        }
      } catch (err) {
        if (err.code) return withErrorCodeAlias(err)  // 已是标准错误
        throw err
      }
    }
  }
]

module.exports = skills
