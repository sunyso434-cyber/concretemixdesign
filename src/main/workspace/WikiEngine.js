// WikiEngine - 简化版 (Task 1.10)
// - P1 简化版：直接写，不原子性（不建 .tmp/，不 fsync）。P2 Task 2.1 升级。
// - 职责：
//   1. 校验工作区状态（ready）
//   2. 校验源文件存在
//   3. 调 reader.read 读源文件
//   4. 计算 slug（lowercase + 空格转 `-` + 保留中文/word + 剥离其他）
//   5. 写 wiki/sources/<slug>.md（# <slug>\n\n<content>\n）
//   6. 返回简化 result { status, pagesCreated, pagesUpdated, refsUpdated, durationMs }
//
// 错误处理：
// - 工作区未打开 → NOT_OPEN（不 retry）
// - 源文件不存在 → FILE_NOT_FOUND（不 retry）
// - reader.read 抛 WorkspaceError（reader 已带 code）→ 透传
// - reader.read 抛普通 Error（扩展名不支持）→ 包装为 READ_FAIL（不 retry）
// - 写文件失败 → WRITE_FAIL（retryable）
const fs = require('fs').promises
const path = require('path')
const matter = require('gray-matter')
const { WorkspaceError } = require('./WorkspaceError')
const wikiHeadings = require('./wiki-headings')
const reader = require('./readers')
const wikiSegmentation = require('./WikiSegmentation')
const {
  SINGLE_SEGMENT_MAX_SIZE,
  TABLE_MAX_ROWS,
  RELEVANCE_THRESHOLD_HIGH,
  DEFAULT_CONTEXT_LINES
} = wikiSegmentation
const { loadIndex, saveIndex } = require('./index-store')
const { queryBM25, buildBM25 } = require('./bm25')
const { tokenize } = require('./tokenizer')
const { tokenizeQuery, scoreSegment, computeIdf } = require('./relevance')

// FNV-1a 32-bit（与前端 src/renderer/utils/workspaceFile.js toSlug 保持完全一致）
// 原因：跨平台同步实现，避免 SHA-1 Web Crypto 异步 API 问题

// glob → RegExp 编译（workspace_grep 用）
// 支持的标准模式：*.md / *.{md,json} / * / sources/*.md / foo-?.md
// 转义规则：. + ^ $ { } ( ) | [ ] \ 等元字符转义，* → [^/]*，? → [^/]
function compileGlob(glob) {
  if (typeof glob !== 'string' || glob.length === 0) {
    throw new Error('glob 不能为空')
  }
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      // {a,b,c} → (a|b|c)
      const end = glob.indexOf('}', i)
      if (end < 0) throw new Error('未闭合的 {')
      const alts = glob.slice(i + 1, end).split(',').map(s => escapeRegex(s)).join('|')
      re += '(?:' + alts + ')'
      i = end
    } else if ('.+^$()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
    i++
  }
  return new RegExp('^' + re + '$', 'u')
}

function escapeRegex(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

// localISOString 单一来源已迁至 ./wiki-ingest.js（2026-08-23 拆分），此处回引（lint/recordAnswer 仍用）
const localISOString = require('./wiki-ingest').localISOString
const wikiReadPage = require('./wiki-readpage')
const wikiLintGrep = require('./wiki-lint-grep')
const wikiAnswer = require('./wiki-answer')

// MAX_OUTPUT_SIZE/SUMMARY_MAX_CHARS 单一来源已迁至 ./wiki-readpage.js，此处回引
const { MAX_OUTPUT_SIZE, SUMMARY_MAX_CHARS } = require('./wiki-readpage')
// Clean-headings 常量与方法已迁至 ./wiki-headings.js（2026-08-23 拆分，行为不变）


// Task 6: 批量摘要常量
const MAX_CONCURRENT = 5
const MAX_TOTAL = 10
const SUMMARIZE_TIMEOUT_MS = 8000
const BATCH_TIMEOUT_MS = 30000

class WikiEngine {
  // Task 5.2：加 kgExtractor 参数（注入 KG 提取器，P5.1 KGExtractor）
  // - 不注入 → 等同 quality:low 降级（不写 kg/，不破坏现有行为，向后兼容）
  // - 注入 → ingest 流程加 KG 步骤，在 .tmp/ 阶段准备 kg/sources/<slug>.json，
  //   提交阶段和 .md 一起 rename 到 wiki/kg/sources/<slug>.json
  constructor({ workspace, kgExtractor = null, deepseekService = null, summaryExtractor = null }) {
    this.workspace = workspace
    this.kgExtractor = kgExtractor
    this.deepseekService = deepseekService
    this.summaryExtractor = summaryExtractor
    // BM25 全量重建串行锁（Promise 链）
    // 并发 ingest 时多个全量 rebuild 重叠会导致 N² readFile 内存叠加，
    // 用链式锁让 BM25 重建部分串行排队执行
    this._bm25Lock = Promise.resolve()
  }

  _splitIntoSegments(content) {
    return wikiSegmentation.splitIntoSegments(content)
  }

  _parseLineInfo(content) {
    return wikiSegmentation.parseLineInfo(content)
  }

  _detectTableRegions(lines) {
    return wikiSegmentation.detectTableRegions(lines)
  }

  _isTableLine(text) {
    return wikiSegmentation.isTableLine(text)
  }

  _splitByHeadings(lines, tableLines) {
    return wikiSegmentation.splitByHeadings(lines, tableLines)
  }

  _splitSectionByBlankLines(lines, sectionStartLine, level) {
    return wikiSegmentation.splitSectionByBlankLines(lines, sectionStartLine, level)
  }

  _splitLargeSegmentByLines(lines) {
    return wikiSegmentation.splitLargeSegmentByLines(lines)
  }

  _truncateToSize(content, maxBytes) {
    return wikiSegmentation.truncateToSize(content, maxBytes)
  }

  _decideMode(scored, contextLines = DEFAULT_CONTEXT_LINES) {
    return wikiSegmentation.decideMode(scored, contextLines)
  }
  // Task 2.6 + Task 3.4: search - BM25 全文搜索 + snippet 生成（spec §4.5/§4.7 + §4.12）
  // - 返回 SearchHit[]：{ path, title, snippet, score, sourceType: 'wiki' | 'chatHistory' }
  // - Task 3.4 (P3)：合并 wiki + chat-history 两个 BM25 索引，统一排序截 topK
  // - snippet 规则：找第一个匹配位置，前后各取 50/150 字符，前后加 … 省略号
  // - 空 query → []，NOT_OPEN → WorkspaceError(NOT_OPEN)
  async search(query, topK = 5) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

    if (!query || !query.trim()) return []

    // v4.9.4 (P2a follow-up I-1)：删 fallback 桥接，直接用持久化 .workspace-index.json
    // 之前 fallback 是因为 ingest→index 桥接缺失，search 每次 rebuild BM25
    // 现在 ingest 已写 index（line ~135），search 直接读持久化索引
    const index = await loadIndex(current.path)
    const wikiIndex = index.bm25Index || { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
    const chatIndex = index.chatBM25Index || { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
    const answerIndex = index.answerBM25Index || { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }

    // Task 3.4 (P3)：两边分别查，合并排序后截 topK
    const wikiHits = queryBM25(wikiIndex, query, topK)
    const chatHits = queryBM25(chatIndex, query, topK)
    const answerHitsRaw = queryBM25(answerIndex, query, topK)

    const wikiTagged = wikiHits.map(h => ({ ...h, sourceType: 'wiki' }))
    const chatTagged = chatHits.map(h => ({ ...h, sourceType: 'chatHistory' }))
    // Task 2（知识库刷新）：answer 命中按可配置系数降权（默认 0.8），排在规范原文之后
    const { getRefreshConfig } = require('./refresh-config')
    const refreshCfg = await getRefreshConfig()
    const answerTagged = answerHitsRaw.map(h => ({
      ...h,
      score: h.score * refreshCfg.demoteFactor,
      sourceType: 'answer'
    }))

    const merged = wikiTagged.concat(chatTagged).concat(answerTagged)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    // 生成 snippet + 摘要增强
    const queryTokens = new Set(tokenize(query))

    const enriched = []
    for (const hit of merged) {
      const absPath = path.posix.join(current.path, 'wiki', hit.path)
      let content = '', fmData = {}
      try {
        const raw = await fs.readFile(absPath, 'utf-8')
        // 统一走 gray-matter（chat-history 也有 frontmatter，只是 summary/keyPoints 为 null）
        const parsed = matter(raw)
        fmData = parsed.data
        content = parsed.content
      } catch { continue }

      // 找第一个匹配位置
      let matchPos = -1
      for (let i = 0; i < content.length - 1; i++) {
        const sub = content.substr(i, 50).toLowerCase()
        for (const t of queryTokens) {
          if (sub.includes(t)) { matchPos = i; break }
        }
        if (matchPos >= 0) break
      }

      let snippet
      if (matchPos < 0) {
        snippet = content.substring(0, 100) + (content.length > 100 ? '…' : '')
      } else {
        const start = Math.max(0, matchPos - 50)
        const end = Math.min(content.length, matchPos + 150)
        const prefix = start > 0 ? '…' : ''
        const suffix = end < content.length ? '…' : ''
        snippet = prefix + content.substring(start, end) + suffix
      }

      enriched.push({
        ...hit,
        title: hit.path,
        snippet,
        summary: fmData.summary || null,
        description: fmData.summary || null,  // OKF alias
        keyPoints: fmData.keyPoints || [],
        tags: fmData.tags || []
      })
    }

    // keyPoints 命中加权：keyPoints 命中 query token 的页排序 +0.2 bonus
    const queryTokenSet = tokenizeQuery(query)
    for (const hit of enriched) {
      const kpText = (hit.keyPoints || []).join(' ')
      const kpTokens = new Set(tokenize(kpText))
      let kpHits = 0
      for (const t of queryTokenSet) { if (kpTokens.has(t)) kpHits++ }
      hit.keyPointsBonus = kpHits > 0 ? 0.2 : 0
      hit.adjustedScore = hit.score + hit.keyPointsBonus
    }
    enriched.sort((a, b) => b.adjustedScore - a.adjustedScore)

    return enriched
  }

  // Task 5: _summarizeWithLLM — 调用 DeepSeek 对段落做摘要（主路径）
  async _summarizeWithLLM(segment, query, deepseekService) {
    const prompt = `请用简洁的中文总结以下段落，保留与查询相关的关键信息（数值、结论、专有名词）。摘要不超过 ${SUMMARY_MAX_CHARS} 字符。

查询：${query}

段落内容：
${segment.text}

摘要：`
    const raw = await deepseekService.invoke(prompt)
    const trimmed = raw.trim().slice(0, SUMMARY_MAX_CHARS)
    return trimmed + '\n\n（_如需完整内容，请重新调用 workspace_readPage 不传 query 参数_）'
  }

  // Task 5: _summarizeHeuristic — 启发式摘要（降级路径，不依赖 LLM）
  _summarizeHeuristic(text) {
    const lines = text.split('\n')
    const kept = []
    const firstSentences = text.match(/[^.。!?？!]+[.。!?？!]/g)?.slice(0, 2).join('') || ''
    if (firstSentences) kept.push(firstSentences.trim())
    const numericLines = lines.filter(line => /\d/.test(line) && line.length < 200).slice(0, 3)
    numericLines.forEach(l => { if (!kept.includes(l)) kept.push(l) })
    let summary = kept.join('\n')
    if (summary.length < text.length) summary += '...'
    summary = summary.slice(0, SUMMARY_MAX_CHARS)
    return summary + '\n\n（_如需完整内容，请重新调用 workspace_readPage 不传 query 参数_）'
  }

  // Task 6: _batchSummarize — 批量摘要（并发控制 + 超时 + 降级）
  // 参数：segments = [{id, text, ...}], query, deepseekService
  // 返回：Map<segmentId, summaryText>
  // 策略：
  //   1. 前 MAX_TOTAL 段走 LLM，剩余走启发式
  //   2. LLM 段按 MAX_CONCURRENT 并发
  //   3. 单段超时 SUMMARIZE_TIMEOUT_MS，整批超时 BATCH_TIMEOUT_MS
  //   4. 任何失败/超时 → 降级为 _summarizeHeuristic
  async _batchSummarize(summarySegments, query, deepseekService) {
    const result = new Map()
    if (!summarySegments || summarySegments.length === 0) return result

    // 1. 分组：前 MAX_TOTAL 段走 LLM，剩余走启发式
    const llmSegments = summarySegments.slice(0, MAX_TOTAL)
    const heuristicSegments = summarySegments.slice(MAX_TOTAL)

    // 2. 剩余段直接启发式
    for (const seg of heuristicSegments) {
      result.set(seg.id, this._summarizeHeuristic(seg.text))
    }

    // 3. LLM 段按 MAX_CONCURRENT 并发处理，整批有 30s 超时
    const batchDeadline = Date.now() + BATCH_TIMEOUT_MS

    // 将 llmSegments 分成若干小批次，每批最多 MAX_CONCURRENT 个
    for (let i = 0; i < llmSegments.length; i += MAX_CONCURRENT) {
      // 检查整批超时
      if (Date.now() >= batchDeadline) {
        // 超时：剩余未处理的 LLM 段全部降级
        for (let j = i; j < llmSegments.length; j++) {
          result.set(llmSegments[j].id, this._summarizeHeuristic(llmSegments[j].text))
        }
        break
      }

      const batch = llmSegments.slice(i, i + MAX_CONCURRENT)
      const promises = batch.map(seg => this._summarizeOne(seg, query, deepseekService, batchDeadline))
      const settled = await Promise.allSettled(promises)

      for (let k = 0; k < settled.length; k++) {
        const { status, value } = settled[k]
        if (status === 'fulfilled') {
          result.set(batch[k].id, value)
        } else {
          // LLM 失败 → 降级
          result.set(batch[k].id, this._summarizeHeuristic(batch[k].text))
        }
      }
    }

    return result
  }

  // 辅助：单段摘要（带 8s 超时 + 整批超时感知）
  async _summarizeOne(segment, query, deepseekService, batchDeadline) {
    // 如果整批已超时，直接降级
    const remaining = batchDeadline - Date.now()
    if (remaining <= 0) {
      return this._summarizeHeuristic(segment.text)
    }

    const timeout = Math.min(SUMMARIZE_TIMEOUT_MS, remaining)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SUMMARIZE_TIMEOUT')), timeout)
    )

    try {
      return await Promise.race([
        this._summarizeWithLLM(segment, query, deepseekService),
        timeoutPromise
      ])
    } catch {
      return this._summarizeHeuristic(segment.text)
    }
  }

  // Task 7: _assemble — 拼接输出 + 长度优先截断
  // 将 full/summary 段按原顺序拼接，超 300KB 时截断。
  // 参数：decided = [{...segment, mode:'full'|'summary', score}], deepseekService, query
  // 返回：{ content, stats }
  async _assemble(decided, deepseekService, query) {
    const startTime = Date.now()

    // 1. 收集需要摘要的段落
    const summarySegments = decided.filter(seg => seg.mode === 'summary')

    // 2. 调 _batchSummarize 获取摘要（Map<id, summaryText>）
    const summaryMap = await this._batchSummarize(summarySegments, query, deepseekService)

    // 3. 按原顺序拼接
    const parts = []
    let fullCount = 0
    let summaryCount = 0
    let contextCount = 0

    for (let i = 0; i < decided.length; i++) {
      const seg = decided[i]
      const displayNum = i + 1  // 1-based 段号

      if (seg.mode === 'full') {
        // full 段：添加注释标记 + 原始文本
        const comment = `<!-- [段 ${displayNum}, 完整保留, 分数=${seg.score.toFixed(2)}] -->`
        parts.push(comment + '\n' + seg.text)
        fullCount++
      } else {
        // summary 段：添加注释标记 + 摘要
        const summary = summaryMap.get(seg.id) || this._summarizeHeuristic(seg.text)
        const originalLineCount = seg.text.split('\n').length
        const comment = `<!-- [段 ${displayNum}, 已压缩, 原 ${originalLineCount} 行, 分数=${seg.score.toFixed(2)}] -->`
        parts.push(comment + '\n' + summary)
        summaryCount++
      }
    }

    // 4. 计算 contextSegments（full 段中非命中、因上下文扩展而保留的段）
    for (const seg of decided) {
      if (seg.mode === 'full' && seg.score <= RELEVANCE_THRESHOLD_HIGH) {
        contextCount++
      }
    }

    // 5. 拼接所有段（段间用双换行分隔）
    let assembled = parts.join('\n\n')

    // 6. 计算原始大小（所有段原始文本拼接）
    const originalContent = decided.map(seg => seg.text).join('\n\n')
    const originalSize = Buffer.byteLength(originalContent, 'utf-8')

    // 7. 截断到 300KB
    let truncated = false
    if (Buffer.byteLength(assembled, 'utf-8') > MAX_OUTPUT_SIZE) {
      assembled = this._truncateToSize(assembled, MAX_OUTPUT_SIZE)
      truncated = true
    }

    const filteredSize = Buffer.byteLength(assembled, 'utf-8')
    const compressionRatio = originalSize > 0 ? filteredSize / originalSize : 1

    return {
      content: assembled,
      stats: {
        totalSegments: decided.length,
        fullSegments: fullCount,
        summarySegments: summaryCount,
        contextSegments: contextCount,
        originalSize,
        filteredSize,
        compressionRatio,
        truncated,
        elapsedMs: Date.now() - startTime
      }
    }
  }

  // Task 6.6 (P6 健壮性)：内部方法 - 调 rotateLog 轮转 log.md
  // - 失败 catch 后只 console.warn，不抛（spec §4.13：log 轮转失败不影响主流程）
  async _maybeRotateLog() {
    try {
      const { rotateLog } = require('./log-rotator')
      await rotateLog(this.workspace.current().path)
    } catch (err) {
      console.warn('[WikiEngine._maybeRotateLog] log 轮转失败:', err.message)
    }
  }

  // 知识库刷新：清除其他页里指向 newPageRel 的旧反向条目（重导前调用）
  // - 扫 wiki/sources/*.md 的 relatedPages，过滤掉 r.page === newPageRel 的条目
  // - 无变化就不写盘（避免无谓 fs.writeFile + mtime 抖动）
  async _purgeReverseLinks(newPageRel) {
    const current = this.workspace.current()
    const sourcesDir = path.join(current.path, 'wiki', 'sources')
    let entries = []
    try { entries = await fs.readdir(sourcesDir) } catch (err) { if (err.code !== 'ENOENT') throw err }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue
      const abs = path.join(sourcesDir, name)
      try {
        const raw = await fs.readFile(abs, 'utf-8')
        // ponytail: 传 {} 绕过 gray-matter 模块级缓存（按 file.content 字符串 key）
        const { data: fm, content } = matter(raw, {})
        if (!Array.isArray(fm.relatedPages)) continue
        const filtered = fm.relatedPages.filter(r => r.page !== newPageRel)
        if (filtered.length === fm.relatedPages.length) continue // 无变化
        fm.relatedPages = filtered
        fm.updated_at = localISOString()
        await fs.writeFile(abs, matter.stringify(content, fm).replace(/\r\n/g, '\n'), 'utf-8')
      } catch (err) {
        console.warn(`[WikiEngine] 清悬空反向引用失败 (${name}):`, err.message)
      }
    }
  }

  // 知识库刷新：按语义映射写入反向关系（清悬空后调用）
  // - 用 REVERSE_RELATION_MAP[link.relation] 把正向映射成反向（引用→被引用 / 补充→被补充 / 反驳→被反驳 / 对比→对比）
  // - 未知 relation 回退「被引用」（防 LLM 输出新词丢关联）
  // - 幂等：target.relatedPages 里已有 newPageRel 则跳过（避免清悬空后再被加回来）
  // - 单条失败不影响其它（try/catch + console.warn）
  // @returns {Promise<number>} 实际更新的反向条目数
  async _updateReverseLinks(newPageRel, relatedLinks) {
    const current = this.workspace.current()
    const { REVERSE_RELATION_MAP } = require('./refresh-config')
    let refsUpdated = 0
    for (const link of (relatedLinks || [])) {
      try {
        const targetPath = path.join(current.path, 'wiki', link.page)
        const raw = await fs.readFile(targetPath, 'utf-8')
        // ponytail: 传 {} 绕过 gray-matter 模块级缓存（按 file.content 字符串 key）
        const { data: targetFm, content: targetContent } = matter(raw, {})
        const existingRelated = Array.isArray(targetFm.relatedPages) ? targetFm.relatedPages : []
        if (existingRelated.some(r => r.page === newPageRel)) continue
        const reverse = REVERSE_RELATION_MAP[link.relation] || '被引用'
        existingRelated.push({ page: newPageRel, relation: reverse, confidence: link.confidence || 0.8 })
        targetFm.relatedPages = existingRelated
        targetFm.updated_at = localISOString()
        await fs.writeFile(targetPath, matter.stringify(targetContent, targetFm).replace(/\r\n/g, '\n'), 'utf-8')
        refsUpdated++
      } catch (err) {
        console.warn(`[WikiEngine] 反向关联更新失败 (${link.page}):`, err.message)
      }
    }
    return refsUpdated
  }

  computeSections(content) {
    return wikiHeadings.computeSections(content, (c) => this._splitIntoSegments(c))
  }

  _mergeEmptySections(sections) {
    return wikiHeadings.mergeEmptySections(sections)
  }

  _extractHeading(seg) {
    return wikiHeadings.extractHeading(seg)
  }

  _findRealHeadingInSegment(lines) {
    return wikiHeadings.findRealHeadingInSegment(lines)
  }

  _looksLikeBodyText(trimmed) {
    return wikiHeadings.looksLikeBodyText(trimmed)
  }

  _isFakeHeading(heading, firstLine) {
    return wikiHeadings.isFakeHeading(heading, firstLine)
  }
}

// 2026-08-23 拆分：ingest 导入管线迁至 wiki-ingest.js（行为不变），原型挂载保持调用路径不变
Object.assign(WikiEngine.prototype, require('./wiki-ingest'))
// 2026-08-23 拆分：readPage 管线/grep+lint/recordAnswer 迁至子模块（行为不变）
Object.assign(WikiEngine.prototype, wikiReadPage)
Object.assign(WikiEngine.prototype, wikiLintGrep)
Object.assign(WikiEngine.prototype, wikiAnswer)

module.exports = { WikiEngine, SINGLE_SEGMENT_MAX_SIZE, TABLE_MAX_ROWS, RELEVANCE_THRESHOLD_HIGH, DEFAULT_CONTEXT_LINES, SUMMARY_MAX_CHARS, MAX_CONCURRENT, MAX_TOTAL, SUMMARIZE_TIMEOUT_MS, BATCH_TIMEOUT_MS }
