/**
 * 网页正文抓取核心技能 - web_fetch
 *
 * 单一职责：调 Jina Reader (r.jina.ai) 把任意 URL 转成 LLM 友好的 Markdown/JSON/HTML/Text。
 * 无 API key 模式（用 Jina 免费层，约 20 RPM，WebFetchService 内部已做令牌桶限速）。
 *
 * 与 web_search 的分工：
 * - web_search：返回 {title, url, snippet} 列表，只看摘要
 * - web_fetch  ：抓单 URL 完整正文，给 Agent 喂全文做深度推理
 *
 * 典型链路（DeepSearch 雏形）：
 *   web_search → 拿 URL 列表 → web_fetch 抓正文 → LLM 评估信息够不够 → 不够再搜
 */

const { createError } = require('../agent/ErrorCodes')
const WebFetchService = require('../services/WebFetchService')

/** 把 createError 结果补上 errorCode 别名（与 web-search.js / analyze-concrete-image 一致） */
function withErrorCodeAlias(err) {
  if (err && err.code && !err.errorCode) {
    return { ...err, errorCode: err.code }
  }
  return err
}

const skills = [
  {
    name: 'web_fetch',
    description: '抓取任意网页的完整正文（基于 Jina Reader，免 API key），返回干净的 Markdown/JSON/HTML/Text。web_search 返回的 URL 想看完整正文时调用本技能（例如：规范全文、行情详情、技术博客、新闻报道）。支持用 CSS 选择器只抓页面某一块（如 "article" 或 ".content"）。免费层有速率限制（约 20 RPM，已自动限速）。注意：本技能依赖国外服务 Jina Reader (r.jina.ai)，国内网络需开启全局代理或 TUN 模式才能访问；若用户网络无法访问，请改用 web_search 查看摘要。',
    version: '1.0.0',
    category: 'agent',
    parameters: {
      url: { type: 'string', description: '目标网页 URL，必须 http(s):// 开头', required: true },
      format: {
        type: 'string',
        description: '返回格式：markdown（默认，推荐用于 LLM 阅读）| json（返回 {title, content, url} 结构化）| html | text',
        required: false,
        enum: ['markdown', 'json', 'html', 'text']
      },
      selector: {
        type: 'string',
        description: 'CSS 选择器，只抓页面中匹配的部分（可选）。例如 "article" 只抓文章正文，".content" 只抓 class=content 的元素，跳过导航/广告/评论',
        required: false
      }
    },
    services: [],
    async execute(args, ctx) {
      // 1. 校验 url
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) {
        return withErrorCodeAlias(createError('E-SEARCH-INVALID-QUERY', 'url 不能为空', '请提供 http(s):// 开头的网址'))
      }
      if (!/^https?:\/\//i.test(url)) {
        return withErrorCodeAlias(createError(
          'E-SEARCH-INVALID-QUERY',
          'url 格式无效',
          '请提供 http(s):// 开头的完整网址',
          { received: url }
        ))
      }
      if (url.length > 2048) {
        return withErrorCodeAlias(createError('E-SEARCH-INVALID-QUERY', 'url 过长（>2048 字符）', '请缩短 URL'))
      }

      // 2. 校验 format（非必填，service 层会兜底，但提前校验给出更友好的错误）
      const validFormats = ['markdown', 'json', 'html', 'text']
      if (args.format !== undefined && !validFormats.includes(args.format)) {
        return withErrorCodeAlias(createError(
          'E-SEARCH-INVALID-QUERY',
          `不支持的 format: ${args.format}`,
          `仅支持 ${validFormats.join(' / ')}`,
          { received: args.format, supported: validFormats }
        ))
      }

      // 3. 调服务（无 api key 模式，不需要 systemService 配置）
      const svc = new WebFetchService({ timeout: 60000 })
      try {
        const result = await svc.fetch(url, {
          format: args.format,
          selector: args.selector
        })
        return result
      } catch (err) {
        if (err.code) return withErrorCodeAlias(err)  // 已是标准错误
        throw err
      }
    }
  }
]

module.exports = skills
