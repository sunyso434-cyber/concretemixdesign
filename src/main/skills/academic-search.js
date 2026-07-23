/**
 * 学术搜索核心技能 - academic_search
 *
 * 单一职责：调第三方学术 API（Semantic Scholar / OpenAlex），返回论文结构化字段，
 * 或拿单篇全文（Unpaywall / OpenAlex / arxiv 兜底），或下载 PDF 到工作区入知识库。
 *
 * 与 web_search 的区别：web_search 返回 {title,url,snippet}；academic_search 返回
 * {title,authors,year,venue,abstract,doi,citationCount,openAccessPdf}，专为论文场景设计。
 */

const { createError } = require('../agent/ErrorCodes')
const AcademicSearchService = require('../services/AcademicSearchService')

/** 把 createError 的结果补上 errorCode 别名（与 web-search 同款） */
function withErrorCodeAlias(err) {
  if (err && err.code && !err.errorCode) {
    return { ...err, errorCode: err.code }
  }
  return err
}

const skills = [
  {
    name: 'academic_search',
    description: '搜索科技论文（中英文期刊、预印本），返回结构化字段：标题/作者/年份/期刊/摘要/DOI/引用数。支持 search（关键词搜索论文列表）和 fetch（拿单篇全文 PDF）两种模式。provider 可选 semantic_scholar/openalex/nstl，nstl 覆盖中文期刊最全但只返回摘要（全文需走文献传递申请）。仅当工作区 wiki 知识不足以回答或用户明确要求时才调用，不要每轮都搜。',
    version: '1.0.0',
    category: 'agent',
    parameters: {
      mode: {
        type: 'string',
        enum: ['search', 'fetch'],
        required: true,
        description: 'search=按关键词搜索论文列表；fetch=拿指定论文的全文信息'
      },
      query: {
        type: 'string',
        required: false,
        description: 'search 模式：搜索关键词（1-200 字）'
      },
      doi: {
        type: 'string',
        required: false,
        description: 'fetch 模式：DOI（如 10.1016/j.xxx.2024.123）'
      },
      url: {
        type: 'string',
        required: false,
        description: 'fetch 模式：出版社 URL（自动抽 DOI）'
      },
      title: {
        type: 'string',
        required: false,
        description: 'fetch 模式：论文标题（兜底走 arxiv 搜索）'
      },
      count: {
        type: 'integer',
        required: false,
        description: 'search 模式：返回条数 1-10，默认 5'
      },
      download: {
        type: 'boolean',
        required: false,
        description: 'fetch 模式：是否下载 PDF 到工作区并入知识库（仅在老板明确指名时为 true）'
      }
    },
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return withErrorCodeAlias(createError('E-SYS-999', '系统服务不可用', '请稍后重试'))

      // 1. 校验 mode
      const mode = args.mode
      if (mode !== 'search' && mode !== 'fetch') {
        return withErrorCodeAlias(createError(
          'PARAM_INVALID_FORMAT',
          'mode 必须为 search 或 fetch',
          '请传 mode=search 或 mode=fetch',
          { received: mode }
        ))
      }

      // 2. 读配置（无 getAcademicSearchConfig 时降级到默认值——任务 3 之前容错）
      let cfg = null
      try {
        cfg = (typeof ss.getAcademicSearchConfig === 'function')
          ? await ss.getAcademicSearchConfig()
          : null
      } catch (_) { /* 配置层未就绪时用默认值 */ }
      const provider = (cfg && cfg.provider) || 'semantic_scholar'
      const arxivFallback = !cfg || cfg.arxivFallback !== false

      // 3. 构造 service（通过 global 拿 workspaceManager / wikiEngine，跟 workspaceTools 同款模式）
      const svc = new AcademicSearchService({
        provider,
        arxivFallback,
        workspaceManager: global.workspaceManager || null,
        wikiEngine: global.wikiEngine || null
      })

      try {
        // ============== search 模式 ==============
        if (mode === 'search') {
          const query = typeof args.query === 'string' ? args.query.trim() : ''
          if (!query) {
            return withErrorCodeAlias(createError('E-SEARCH-INVALID-QUERY', 'query 不能为空', '请提供搜索关键词'))
          }
          if (query.length > 200) {
            return withErrorCodeAlias(createError('E-SEARCH-INVALID-QUERY', 'query 过长（>200 字符）', '请缩短搜索关键词'))
          }
          return await svc.search(query, args.count || 5)
        }

        // ============== fetch 模式 ==============
        if (mode === 'fetch') {
          if (!args.doi && !args.url && !args.title) {
            return withErrorCodeAlias(createError(
              'E-SEARCH-NO-DOI',
              '需要 doi / url / title 之一',
              '请至少提供其中一个参数'
            ))
          }
          const fetchResult = await svc.fetchFulltext({
            doi: args.doi,
            url: args.url,
            title: args.title
          })
          // 错误码直接透传
          if (fetchResult?.success === false) {
            return withErrorCodeAlias(fetchResult)
          }

          // 老板明确指名下载时
          if (args.download && fetchResult?.fulltext?.available && fetchResult.fulltext.pdfUrl) {
            const pdfMeta = {
              title: args.title || fetchResult.title || '',
              authors: fetchResult.authors || [],
              year: fetchResult.year || null,
              fulltext: fetchResult.fulltext
            }
            const downloadResult = await svc.downloadAndIngest(
              fetchResult.fulltext.pdfUrl,
              pdfMeta
            )
            // 把下载/入库结果合并到 fulltext 字段
            return {
              ...fetchResult,
              fulltext: downloadResult
            }
          }
          return fetchResult
        }
      } catch (err) {
        if (err?.code) return withErrorCodeAlias(err)
        throw err
      }
    }
  }
]

module.exports = skills