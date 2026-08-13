/**
 * 网页正文抓取核心技能 - web_fetch
 *
 * 单一职责：把任意 URL 转成 LLM 友好的 Markdown/JSON/HTML/Text。
 *
 * 支持两个 provider（通过 configure_web_fetch 切换）：
 * - jina：基于 Jina Reader (r.jina.ai)，免 API key，约 20 RPM（默认兜底）
 * - tinyfish：POST api.fetch.tinyfish.ai，需 key（与 web_search 的 tinyfish key 共用），150 URL/分钟
 * - auto（默认）：web_search 配了 tinyfish 就用 tinyfish，否则用 jina
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
    description: '抓取任意网页的完整正文，返回干净的 Markdown/JSON/HTML/Text。web_search 返回的 URL 想看完整正文时调用本技能（例如：规范全文、行情详情、技术博客、新闻报道）。支持用 CSS 选择器只抓页面某一块（如 "article" 或 ".content"）。provider 默认 auto：web_search 配了 tinyfish 就用 tinyfish（需全局代理），否则用 Jina Reader（也需全局代理）。配置切换调 configure_web_fetch。',
    version: '1.1.0',
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
    services: ['systemService'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) return withErrorCodeAlias(createError('E-SYS-999', '系统服务不可用', '请稍后重试'))

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

      // 3. 读 web_fetch 配置
      let fetchCfg = null
      try {
        fetchCfg = await ss.getWebFetchConfig()
      } catch (_) { /* ignore */ }
      if (!fetchCfg || fetchCfg.enabled === false) {
        return withErrorCodeAlias(createError(
          'E-SEARCH-NOT-CONFIGURED',
          '网页抓取未启用',
          '请说「开启网页抓取」调用 configure_web_fetch',
          { hint: 'configure_web_fetch' }
        ))
      }

      // 4. 根据 provider 设置决定实际 provider 和 apiKey
      //    - jina：免 key
      //    - tinyfish/auto：复用 web_search 的 tinyfish key
      const providerSetting = fetchCfg.provider || 'auto'
      let actualProvider = 'jina'
      let apiKey

      if (providerSetting !== 'jina') {
        // tinyfish 或 auto 都需要读 web_search 配置拿 tinyfish key
        let searchCfg = null
        try {
          searchCfg = await ss.getWebSearchConfig()
        } catch (_) { /* ignore */ }
        const hasTinyfishKey = !!(searchCfg && searchCfg.provider === 'tinyfish' && searchCfg.apiKey)

        if (providerSetting === 'tinyfish') {
          if (!hasTinyfishKey) {
            return withErrorCodeAlias(createError(
              'E-SEARCH-NOT-CONFIGURED',
              'tinyfish 抓取未配置 API key',
              '请先说「配置联网搜索，服务商 tinyfish，api key 是 xxx」调用 configure_web_search',
              { hint: 'configure_web_search' }
            ))
          }
          actualProvider = 'tinyfish'
          apiKey = searchCfg.apiKey
        } else {
          // auto：有 tinyfish key 就用 tinyfish，否则 jina 兜底
          if (hasTinyfishKey) {
            actualProvider = 'tinyfish'
            apiKey = searchCfg.apiKey
          } else {
            actualProvider = 'jina'
          }
        }
      }

      // 5. 调服务
      const svc = new WebFetchService({ provider: actualProvider, apiKey, timeout: 60000 })
      try {
        const result = await svc.fetch(url, {
          format: args.format,
          selector: args.selector
        })
        // 附带实际用的 provider，方便上层展示
        return { ...result, provider: actualProvider }
      } catch (err) {
        if (err.code) return withErrorCodeAlias(err)  // 已是标准错误
        throw err
      }
    }
  }
]

module.exports = skills
