// src/main/workspace/SummaryExtractor.js
// 摘要提取器：与 KGExtractor 并行调用，生成 summary + keyPoints + 语义关联
//
// 设计要点：
// - 两层 catch：外层 LLM 调用、内层 JSON 解析
// - relation 白名单校验（防 LLM 自由发挥）
// - confidence ≥ 0.6 门槛
// - relatedLinks 只能从 existingPages 选（防 hallucination）
// - 失败统一返回 null（不阻塞 ingest）
// - LLM prompt 要求中文 + 保留英文术语原文

const MIN_CONFIDENCE = 0.6
const VALID_RELATIONS = new Set(['引用', '对比', '补充', '反驳'])
const MAX_RELATION_LINKS = 3
const MAX_KEY_POINTS = 5
const MAX_SUMMARY_LEN = 500
const MAX_TAGS_LEN = 200
const DEFAULT_CONFIDENCE = 0.85

class SummaryExtractor {
  constructor({ deepseekService } = {}) {
    this.deepseekService = deepseekService
  }

  /**
   * 从全文生成摘要 + 关键点 + 语义关联链接
   * @param {string} content - 源文件全文
   * @param {string} sourceFile - 源文件名
   * @param {Array<{title, path}>} existingPages - 已有 wiki 页面列表（用于防 hallucination）
   * @returns {Promise<{summary, keyPoints, tags, confidence, relatedLinks, quality} | null>}
   */
  async extract(content, sourceFile, existingPages = []) {
    if (!this.deepseekService) {
      console.warn('[SummaryExtractor] deepseekService 为空，跳过摘要生成（deepseekService 尚未初始化？）')
      return null
    }
    if (!content || !content.trim()) return null

    // 外层 catch：LLM 调用失败
    let raw
    try {
      const prompt = this._buildPrompt(content, existingPages)
      raw = await this.deepseekService.invoke(prompt)
    } catch (err) {
      console.warn('[SummaryExtractor] LLM 调用失败:', err.message)
      return null
    }

    // 内层 catch：JSON 解析失败
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.warn('[SummaryExtractor] JSON 解析失败:', err.message)
      return null
    }

    // 缺 summary 且缺 keyPoints → null
    if (!parsed.summary && (!parsed.keyPoints || parsed.keyPoints.length === 0)) {
      return null
    }

    const validPaths = new Set(existingPages.map(p => p.path))
    const relatedLinks = (parsed.relatedLinks || [])
      .filter(r =>
        r.confidence >= MIN_CONFIDENCE &&
        VALID_RELATIONS.has(r.relation) &&
        validPaths.has(r.page)
      )
      .slice(0, MAX_RELATION_LINKS)

    return {
      summary: String(parsed.summary || '').slice(0, MAX_SUMMARY_LEN),
      keyPoints: (parsed.keyPoints || []).map(String).slice(0, MAX_KEY_POINTS),
      tags: (parsed.tags || []).slice(0, MAX_TAGS_LEN),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : DEFAULT_CONFIDENCE,
      relatedLinks,
      quality: 'high'
    }
  }

  _buildPrompt(content, existingPages) {
    const pageList = existingPages.length > 0
      ? existingPages.map((p, i) => `${i + 1}. ${p.title} (${p.path})`).join('\n')
      : '（无可关联页面）'

    return `从以下混凝土领域文本中完成 4 个任务，输出 JSON：

文本：${content}

任务 1：生成摘要（200-500 字）
- 语言：统一中文，保留关键术语原文（如 "compressive strength（抗压强度）"）

任务 2：提取关键点（3-5 条，每条一句话）

任务 3：整体置信度
- confidence: 0-1（你对本文摘要质量的整体评分）

任务 4：判断语义关联
- relatedLinks: 从已有页面中选择 2-3 个与本文有语义关联的页面
- 关系类型：引用（引用该页信息）、对比（结论差异）、补充（补充信息）、反驳（结论相反）
- 每条带 confidence 0-1
- **硬约束：只能从以下列表中选择 page，不允许自创**

已有页面：
${pageList}

输出格式：
{"summary":"...", "keyPoints":["...","..."], "tags":["..."], "confidence":0.9, "relatedLinks":[{"page":"sources/xxx.md","relation":"引用","confidence":0.9}]}`
  }
}

module.exports = { SummaryExtractor, MIN_CONFIDENCE, VALID_RELATIONS, MAX_RELATION_LINKS, MAX_KEY_POINTS }
