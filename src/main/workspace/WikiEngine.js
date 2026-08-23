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

// Task 2 (readPage relevance filtering): 300KB 输出保护
const MAX_OUTPUT_SIZE = 300 * 1024
// Clean-headings 常量与方法已迁至 ./wiki-headings.js（2026-08-23 拆分，行为不变）

// Task 5: 摘要常量
const SUMMARY_MAX_CHARS = 500

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

  // Task 2.7: readPage 加固 - 加 SIZE_EXCEEDED 检查（> 5MB 抛错，避免内存爆）
  // - 工作区未打开 → NOT_OPEN（不 retry）
  // - 路径穿越防护 → PATH_INVALID
  // - 文件不存在 → PAGE_NOT_FOUND
  // - 文件 > 5MB → SIZE_EXCEEDED（保护内存）
  // - 成功返回 { content, frontmatter, mtime, size }（mtime/size 是数字）
  // Task 2: readPage 签名扩展 - options.query 用于后续 Task 8 相关性过滤
  // 无 query 时走老逻辑 + 300KB 截断保护 + stats 返回
  async readPage(wikiPath, options = {}) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    // 路径穿越防护
    if (wikiPath.includes('..')) {
      throw new WorkspaceError('PATH_INVALID', `wikiPath 非法: ${wikiPath}`, false)
    }
    const absPath = path.posix.join(current.path, 'wiki', wikiPath)
    let stat, raw
    try {
      stat = await fs.stat(absPath)
    } catch {
      throw new WorkspaceError('PAGE_NOT_FOUND', `wiki 页不存在: ${wikiPath}`, false)
    }
    // v2026-06-19 修订：加 SIZE_EXCEEDED 检查（避免内存爆）
    if (stat.size > 5 * 1024 * 1024) {
      throw new WorkspaceError('SIZE_EXCEEDED', `wiki 页 > 5MB (${stat.size} bytes)`, false)
    }
    raw = await fs.readFile(absPath, 'utf-8')
    const { data: fm, content } = matter(raw)

    const query = options.query
    const contextLines = options.contextLines ?? 5
    const depth = options.depth || 'auto'

    // 按行读取（最高优先级）：传 offset 即走按行切片，跳过段过滤/全文截断
    // 用于配合 workspace_grep：grep 返回 lineNumber 后，readPage 用 offset/limit 精读
    // 行号 1-based，对齐 grep 返回的 lineNumber
    if (options.offset != null) {
      return this._readPageByLines(content, fm, stat, options.offset, options.limit)
    }

    // depth 路由：full 走老 4 阶段管线，其他走 relevant 层
    if (depth === 'full') {
      return this._readPageFull(content, fm, stat, query, contextLines)
    }
    return this._readPageRelevant(content, fm, stat, query, contextLines)
  }

  /**
   * 按行切片（offset/limit 模式）
   * - 行号 1-based，对齐 workspace_grep 返回的 lineNumber
   * - offset 超出总行数 → 返回空 content（不抛错，让 LLM 自己判断）
   * - limit 默认 1000，最大 5000（防止单次读取过大）
   * - 返回 stats.mode = 'lines'，附 totalLines 便于 LLM 决定是否继续翻页
   */
  _readPageByLines(content, fm, stat, offset, limit) {
    const DEFAULT_LIMIT = 1000
    const MAX_LIMIT = 5000
    const lines = content.split('\n')
    const totalLines = lines.length

    const start = Math.max(1, Math.floor(Number(offset) || 1))
    const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || DEFAULT_LIMIT)))

    // start 超出总行数 → 返回空 content（不抛错，让 LLM 自己判断）
    if (start > totalLines) {
      return {
        content: '',
        frontmatter: fm,
        mtime: stat.mtimeMs,
        size: stat.size,
        stats: {
          mode: 'lines',
          offset: start,
          limit: lim,
          returnedLines: 0,
          totalLines,
          truncated: false
        }
      }
    }

    const endIdx = Math.min(totalLines, start - 1 + lim)
    const slice = lines.slice(start - 1, endIdx).join('\n')

    return {
      content: slice,
      frontmatter: fm,
      mtime: stat.mtimeMs,
      size: stat.size,
      stats: {
        mode: 'lines',
        offset: start,
        limit: lim,
        returnedLines: endIdx - start + 1,
        totalLines,
        truncated: endIdx < totalLines
      }
    }
  }

  /**
   * 第 3 层：全文层（depth='full'）
   * 现有 4 阶段管线（不改动）
   */
  async _readPageFull(content, fm, stat, query, contextLines) {
    const startMs = Date.now()
    if (!query || !query.trim()) {
      return {
        content: this._truncateToSize(content, MAX_OUTPUT_SIZE),
        frontmatter: fm,
        mtime: stat.mtimeMs,
        size: stat.size,
        stats: { mode: 'full', query: null, elapsedMs: Date.now() - startMs }
      }
    }
    const segments = this._splitIntoSegments(content)
    const queryTokens = tokenizeQuery(query)
    const segmentTokensList = segments.map(seg => new Set(tokenize(seg.text)))
    const idfMap = computeIdf(segmentTokensList)
    const scored = segments.map((seg, i) => ({
      ...seg,
      tokens: segmentTokensList[i],
      score: scoreSegment(segmentTokensList[i], queryTokens, idfMap)
    }))
    const decided = this._decideMode(scored, contextLines)
    const { content: filtered, stats } = await this._assemble(decided, this.deepseekService, query)
    return {
      content: filtered,
      frontmatter: fm,
      mtime: stat.mtimeMs,
      size: stat.size,
      stats: { mode: 'full', ...stats, query, elapsedMs: Date.now() - startMs }
    }
  }

  /**
   * 第 1 层：相关段落层（depth='relevant'）
   * - BM25 粗筛 heading
   * - 上下文 ±1 section
   * - BM25 精筛（命中段 score > 0.3）
   * - 10KB 硬上限截断
   * - 无 query → fallthrough 到 _readPageFull（保持 v1.5.3 兼容）
   * - 无 sections → 降级 _fullFiltered
   */
  _readPageRelevant(content, fm, stat, query, contextLines) {
    // 无 query → fallthrough 到 _readPageFull（保持 v1.5.3 300KB 截断全文行为）
    // spec §7 原写"返回 frontmatter 摘要字段"，v4 改为 fallthrough 到 _readPageFull
    // 选择理由：search 已含摘要，readPage 不需要重复；保持 v1.5.3 兼容
    // 【待修订】spec §7 降级表需同步更新为"fallthrough 到 _readPageFull"
    if (!query || !query.trim()) {
      return this._readPageFull(content, fm, stat, null, contextLines)
    }

    const sections = fm.sections || []

    // 无预计算 sections → 降级 _fullFiltered
    if (sections.length === 0) {
      console.warn(`[readPage] ${fm.source || 'unknown'} 缺 sections，降级为 _fullFiltered`)
      return this._fullFiltered(content, fm, stat, query, contextLines)
    }

    // ① BM25 粗筛：query vs section 全文（用内容片段做匹配，比 heading 更鲁棒）
    // 原因：heading 只有 2-3 个 token，"28d" 数字词常不在 heading 里
    const { buildBM25, queryBM25 } = require('./bm25')
    // 用 content 实际行号切片做索引
    const contentLines = content.split('\n')
    const sectionDocs = sections.map(s => ({
      path: String(s.id),
      content: contentLines.slice(s.startLine, s.endLine + 1).join('\n')
    }))
    const sectionIndex = buildBM25(sectionDocs)
    // topK 设大一些，确保所有有命中的 section 都进来（再走精筛去掉低分）
    const headingHits = queryBM25(sectionIndex, query, sections.length)

    // ② 命中 section
    const matchedIds = new Set(headingHits.map(h => sections[parseInt(h.path)]?.id).filter(Boolean))
    const matchedSections = sections.filter(s => matchedIds.has(s.id))

    // ③ ±1 上下文
    const expandedIds = new Set()
    for (const sec of matchedSections) {
      expandedIds.add(sec.id)
      if (sec.id > 0) expandedIds.add(sec.id - 1)
      if (sec.id < sections.length - 1) expandedIds.add(sec.id + 1)
    }
    const expandedSections = sections.filter(s => expandedIds.has(s.id))

    // ④ 按行号切片
    const parts = expandedSections.map(sec =>
      contentLines.slice(sec.startLine, sec.endLine + 1).join('\n')
    )

    // ⑤ BM25 精筛：命中段按 score 过滤，上下文段始终保留
    // 精筛阈值降到 0.1（粗筛已经限制了 matchedIds，精筛只过滤"完全无关"的命中）
    const queryTokens = tokenizeQuery(query)
    const segmentTokensList = parts.map(p => new Set(tokenize(p)))
    const idfMap = computeIdf(segmentTokensList)
    const kept = []
    for (let i = 0; i < expandedSections.length; i++) {
      const sec = expandedSections[i]
      if (!matchedIds.has(sec.id)) {
        kept.push(parts[i])  // 上下文永保留
      } else {
        const score = scoreSegment(new Set(tokenize(parts[i])), queryTokens, idfMap)
        // 阈值 0.1：只要有任何共同 token 就保留（粗筛已经做了语义判断）
        if (score > 0.1) kept.push(parts[i])
      }
    }

    // ⑥ 10KB 硬上限
    const content_out = this._truncateToSize(kept.join('\n\n'), 10 * 1024)

    return {
      depth: 'relevant',
      summary: fm.summary || null,
      description: fm.summary || null,
      keyPoints: fm.keyPoints || [],
      content: content_out,
      relatedPages: fm.relatedPages || [],
      frontmatter: fm,
      mtime: stat.mtimeMs,
      size: stat.size,
      stats: {
        mode: 'relevant',
        totalSections: sections.length,
        matchedSections: matchedSections.length,
        contextSections: expandedSections.length - matchedSections.length,
        returnedSections: kept.length
      }
    }
  }

  /**
   * 降级：旧页面无 sections 时复用 full 管线但跳过 LLM 摘要
   */
  _fullFiltered(content, fm, stat, query, contextLines) {
    const segments = this._splitIntoSegments(content)
    const queryTokens = tokenizeQuery(query)
    const segmentTokensList = segments.map(seg => new Set(tokenize(seg.text)))
    const idfMap = computeIdf(segmentTokensList)
    const scored = segments.map((seg, i) => ({
      ...seg,
      score: scoreSegment(segmentTokensList[i], queryTokens, idfMap)
    }))
    const decided = this._decideMode(scored, contextLines)
    const parts = decided.map(seg =>
      seg.mode === 'full' ? seg.text : this._summarizeHeuristic(seg.text)
    )
    const content_out = this._truncateToSize(parts.join('\n\n'), MAX_OUTPUT_SIZE)
    return {
      depth: 'relevant',
      summary: fm.summary || null,
      description: fm.summary || null,
      keyPoints: fm.keyPoints || [],
      content: content_out,
      relatedPages: fm.relatedPages || [],
      frontmatter: fm,
      mtime: stat.mtimeMs,
      size: stat.size,
      stats: { mode: 'relevant-fallback', returnedSections: decided.length, query }
    }
  }

  // 文档分段与相关性判定已拆到 WikiSegmentation，保留同名方法避免影响现有调用方。
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

  // workspace_grep - 精确正则匹配 + 行号定位（对齐 ripgrep / claude code grep 工具）
  // 与 search（BM25 语义模糊匹配）互补：
  //   - search 找"相关文档"，每页只返回一个 snippet
  //   - grep 找"具体位置"，每个命中行带行号 + 上下文
  // 设计参考：Claude Code 的 Grep 工具 / OpenCode 的 grep 工具 / Codex CLI 的 grep 工具
  //
  // 关键行为：
  //   - 只搜 wiki 正文（跳过 frontmatter）
  //   - 支持正则（精确字符串是正则的特例）；多关键字用 | 分隔
  //   - 支持 -A/-B 上下文行（默认 2 行）
  //   - 支持 -i 忽略大小写
  //   - 支持 glob 文件名过滤
  //   - 支持 3 种输出模式：content / files_with_matches / count
  //   - 支持 head_limit 截断（默认 100 条命中）
  //   - 相邻命中行合并上下文（避免重复输出）
  async grep(pattern, options = {}) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    if (!pattern || typeof pattern !== 'string') {
      throw new WorkspaceError('READ_FAIL', 'pattern 不能为空', false)
    }

    const scope = options.path || 'sources'
    const globPattern = options.glob || '*.md'
    const outputMode = options.output_mode || 'content'
    const ignoreCase = options.ignore_case === true
    const after = Math.max(0, Math.min(50, Number(options.after ?? options.A ?? 2)))
    const before = Math.max(0, Math.min(50, Number(options.before ?? options.B ?? 2)))
    const headLimit = Math.max(1, Math.min(1000, Number(options.head_limit ?? 100)))

    // 编译正则（带 u flag 支持中文；g flag 用于 lastIndex 控制；i flag 忽略大小写）
    let regex
    try {
      const flags = ignoreCase ? 'giu' : 'u'
      regex = new RegExp(pattern, flags)
    } catch (err) {
      throw new WorkspaceError('READ_FAIL', `正则表达式无效: ${err.message}`, false)
    }

    // glob 编译为 RegExp（简单实现：支持 *.md / *.{md,json} / * / sources/*.md）
    let globRe
    try {
      globRe = compileGlob(globPattern)
    } catch (err) {
      throw new WorkspaceError('READ_FAIL', `glob 模式无效: ${err.message}`, false)
    }

    // 决定扫描目录
    const workspaceRoot = current.path
    const wikiRoot = path.posix.join(current.path, 'wiki')
    const scanDirs = []
    if (scope === 'sources' || scope === 'all') {
      scanDirs.push({ rel: 'sources', abs: path.join(wikiRoot, 'sources') })
    }
    if (scope === 'answers' || scope === 'all') {
      scanDirs.push({ rel: 'answers', abs: path.join(wikiRoot, 'answers') })
    }
    if (scope === 'raw') {
      scanDirs.push({ rel: 'raw', abs: path.join(workspaceRoot, 'raw') })
    }
    if (scope === 'root') {
      // root：整个工作区根目录，扫描所有子目录的文本文件
      scanDirs.push({ rel: 'sources', abs: path.join(wikiRoot, 'sources') })
      scanDirs.push({ rel: 'answers', abs: path.join(wikiRoot, 'answers') })
      scanDirs.push({ rel: 'raw', abs: path.join(workspaceRoot, 'raw') })
      scanDirs.push({ rel: 'reports', abs: path.join(workspaceRoot, 'reports') })
    }

    // 扫描文件
    const allMatches = []   // { path, lineNumber, line, before, after }
    let scannedFiles = 0

    for (const dir of scanDirs) {
      let entries = []
      try {
        entries = await fs.readdir(dir.abs)
      } catch (err) {
        if (err.code === 'ENOENT') continue
        throw err
      }

      for (const name of entries) {
        if (!globRe.test(name)) continue
        const abs = path.join(dir.abs, name)
        let stat
        try {
          stat = await fs.stat(abs)
        } catch { continue }
        if (!stat.isFile()) continue

        scannedFiles++
        let raw
        try {
          raw = await fs.readFile(abs, 'utf-8')
        } catch { continue }

        // 分离 frontmatter，只搜正文
        const { content } = matter(raw)
        const lines = content.split('\n')
        const relPath = `${dir.rel}/${name}`

        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0
          if (regex.test(lines[i])) {
            allMatches.push({
              path: relPath,
              lineNumber: i + 1,   // 1-based，对齐 ripgrep
              line: lines[i],
              before: lines.slice(Math.max(0, i - before), i),
              after: lines.slice(i + 1, Math.min(lines.length, i + 1 + after))
            })
          }
        }
      }
    }

    // scannedFiles=0 预警：搜索范围可能配置错误，避免 AI 静默忽略
    const warning = scannedFiles === 0
      ? `⚠️ 未扫描任何文件（scannedFiles=0）。可能原因：path="${scope}" 目录不存在或为空、glob="${globPattern}" 未匹配任何文件。建议改 path 参数为 root（全工作区）或 all（sources+answers）后重试。`
      : null

    // 按 output_mode 返回
    if (outputMode === 'files_with_matches') {
      const files = []
      const seen = new Set()
      for (const m of allMatches) {
        if (!seen.has(m.path)) {
          seen.add(m.path)
          files.push({ path: m.path, matchCount: allMatches.filter(x => x.path === m.path).length })
        }
      }
      return {
        matches: files.slice(0, headLimit),
        total: files.length,
        truncated: files.length > headLimit,
        scannedFiles,
        ...(warning ? { warning } : {})
      }
    }

    if (outputMode === 'count') {
      const counts = {}
      for (const m of allMatches) {
        counts[m.path] = (counts[m.path] || 0) + 1
      }
      const arr = Object.entries(counts).map(([p, c]) => ({ path: p, count: c }))
      return {
        matches: arr.slice(0, headLimit),
        total: arr.length,
        truncated: arr.length > headLimit,
        scannedFiles,
        ...(warning ? { warning } : {})
      }
    }

    // content 模式：截断
    const total = allMatches.length
    const truncated = total > headLimit
    return {
      matches: allMatches.slice(0, headLimit),
      total,
      truncated,
      scannedFiles,
      ...(warning ? { warning } : {})
    }
  }

  // Task 2.8: lint - 扫 4 类健康检查 + contradictions 占位（spec §4.2 / §4.5）
  // - missingFrontmatter：frontmatter 缺 5 必填（title/source/ingested_at/updated_at/quality）
  // - orphans：无任何 [[wiki/path]] 引用入链的页
  // - missingCrossRefs：正文含 [[xxx]] 但 xxx 不存在
  // - staleSummaries：源文件 mtime > wiki 页 mtime（原始设计：优先 updated_at，缺失 fallback ingested_at）
  // - contradictions：V1.5 可选，本任务始终返回空数组
  // - 工作区未打开 → NOT_OPEN（不 retry）
  async lint() {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

    // v4.9.4 (P2a follow-up M-8)：5 必填（含 updated_at）
    // 之前 4 必填（title/source/ingested_at/quality）漏 updated_at
    // 但 ingest 写 5 字段，lint 不检会漏报过期/缺失
    const REQUIRED_FM = ['type', 'title', 'source', 'ingested_at', 'updated_at', 'quality']
    const wikiRoot = path.posix.join(current.path, 'wiki')
    const sourcesDir = path.join(wikiRoot, 'sources')

    const missingFrontmatter = []
    const orphans = []
    const missingCrossRefs = []
    const staleSummaries = []

    // 1. 枚举 wiki/sources/*.md
    let entries = []
    try {
      entries = await fs.readdir(sourcesDir)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    const mdFiles = entries.filter(name => name.endsWith('.md')).sort()

    // 2. 解析每个 wiki 页：frontmatter 完整性 + 正文 [[ref]] 抽取
    const pageInfos = []  // { relPath, frontmatter, content, wikiMtime }
    const allPages = new Set()  // 用于 cross-ref 检查
    for (const name of mdFiles) {
      const relPath = `sources/${name}`
      allPages.add(relPath)
      const abs = path.join(sourcesDir, name)
      let raw, stat
      try {
        raw = await fs.readFile(abs, 'utf-8')
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      const { data: frontmatter, content } = matter(raw)
      const presentKeys = Object.keys(frontmatter || {})
      const missing = REQUIRED_FM.filter(k => !presentKeys.includes(k))
      if (missing.length > 0) {
        missingFrontmatter.push({ path: relPath, missing })
      }
      pageInfos.push({ relPath, frontmatter, content, wikiMtime: stat.mtimeMs })
    }

    // 3. orphans / missingCrossRefs：扫每个页正文的 [[ref]] + frontmatter.relatedPages
    const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g
    const referencedBy = new Map()  // ref → Set<relPath>
    for (const info of pageInfos) {
      const links = new Set()
      let m
      const re = new RegExp(WIKI_LINK_RE.source, 'g')
      while ((m = re.exec(info.content)) !== null) {
        links.add(m[1].trim())
      }
      // v9.1.0：frontmatter.relatedPages 也算作出链（方案 A：frontmatter 承担关联网络）
      const relatedPages = Array.isArray(info.frontmatter?.relatedPages) ? info.frontmatter.relatedPages : []
      for (const rp of relatedPages) {
        if (rp && typeof rp.page === 'string') links.add(rp.page.trim())
      }
      for (const ref of links) {
        if (!referencedBy.has(ref)) referencedBy.set(ref, new Set())
        referencedBy.get(ref).add(info.relPath)
      }
    }
    // orphans：pageInfos 中没有任何入链（正文 [[ref]] 或被别人 relatedPages 指向）的页
    for (const info of pageInfos) {
      const inLinks = referencedBy.get(info.relPath)
      if (!inLinks || inLinks.size === 0) {
        orphans.push({ path: info.relPath })
      }
    }
    // missingCrossRefs：[[xxx]] 但 xxx 不存在
    // ref 解析规则（覆盖常见写法）：
    //   - "sources/b.md"   → 比对 allPages
    //   - "sources/b"      → 比对 "sources/b.md"
    //   - "b"              → 比对 "sources/b.md"
    //   - "concepts/x"     → 不在 sources/ 下，作为缺失
    function refExists(ref) {
      if (allPages.has(ref)) return true
      const noExt = ref.replace(/\.md$/, '')
      if (allPages.has(noExt)) return true
      // 裸名（如 "b"）→ "sources/b.md"
      if (allPages.has(`sources/${noExt}.md`)) return true
      // 带 sources/ 但无后缀（如 "sources/b"）→ "sources/b.md"
      if (noExt.startsWith('sources/') && allPages.has(`${noExt}.md`)) return true
      return false
    }
    for (const info of pageInfos) {
      const re = new RegExp(WIKI_LINK_RE.source, 'g')
      let m
      while ((m = re.exec(info.content)) !== null) {
        const ref = m[1].trim()
        if (!refExists(ref)) {
          missingCrossRefs.push({ path: info.relPath, ref })
        }
      }
    }

    // 4. staleSummaries：源文件 mtime > wiki 页 mtime
    // 原始设计（v1.5.3 沿用）：优先 frontmatter.updated_at，缺失 fallback ingested_at
    // 若 frontmatter 都缺失 → 用 wiki 文件自身 mtime 与源文件比
    for (const info of pageInfos) {
      const sourceRel = info.frontmatter && info.frontmatter.source
      if (!sourceRel || typeof sourceRel !== 'string') continue
      const sourceAbs = path.posix.join(current.path, sourceRel)
      let sourceStat
      try {
        sourceStat = await fs.stat(sourceAbs)
      } catch {
        continue  // 源文件不存在 → 跳过
      }
      // 优先 updated_at，没有则 fallback ingested_at，都没有则用 wiki 文件 mtime
      let wikiTs
      const fmTs = (info.frontmatter && (info.frontmatter.updated_at || info.frontmatter.ingested_at)) || null
      if (fmTs) {
        const t = Date.parse(fmTs)
        wikiTs = Number.isFinite(t) ? t : info.wikiMtime
      } else {
        wikiTs = info.wikiMtime
      }
      if (sourceStat.mtimeMs > wikiTs) {
        staleSummaries.push({
          path: info.relPath,
          sourceFile: sourceRel,
          sourceMtime: sourceStat.mtimeMs,
          wikiMtime: wikiTs
        })
      }
    }

    return {
      missingFrontmatter,
      orphans,
      missingCrossRefs,
      staleSummaries,
      contradictions: [],  // V1.5 可选，本任务留空
      scannedAt: localISOString()
    }
  }

  // Task 2.9: recordAnswer - 把重要问答回填到 wiki（spec §4.2）
  // - 工作区未打开 → NOT_OPEN（不 retry）
  // - 写到 wiki/answers/<timestamp>.md（frontmatter 含 question/answered_at/refs）
  // - 更新 wiki/index.md（追加「## 问答」节的链接）
  // - 加 log（写到 wiki/log.md，schema §4 格式 `## [YYYY-MM-DD HH:mm] answer | <subject>`）
  // - 不重建 BM25（answer 文档不入索引，符合 spec）
  async recordAnswer(q, a, refs) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

    const wikiDir = path.join(current.path, 'wiki')
    const now = new Date()
    const tsFile = now.toISOString().replace(/[:.]/g, '-')  // 文件名安全
    const tsLog = now.toISOString().slice(0, 16).replace('T', ' ')  // log 行用 YYYY-MM-DD HH:mm

    const answersDir = path.join(wikiDir, 'answers')
    await fs.mkdir(answersDir, { recursive: true })

    // 知识库刷新：upsert —— BM25 粗筛候选，再用问题文本 2-gram Jaccard 判是否同一问题
    // ponytail：Jaccard 只识别措辞高度相似的重复；语义相同但措辞差异大的重复本期不处理（需 embedding，YAGNI）
    const { getRefreshConfig } = require('./refresh-config')
    let overwriteRel = null
    try {
      const idxForUpsert = await loadIndex(current.path)
      const ai = idxForUpsert.answerBM25Index
      if (ai && ai.totalDocs > 0) {
        const cfg = await getRefreshConfig()
        const hits = queryBM25(ai, q, 1)
        if (hits.length > 0) {
          const candAbs = path.join(current.path, 'wiki', hits[0].path)
          const candRaw = await fs.readFile(candAbs, 'utf-8')
          const candQ = matter(candRaw).data.question || ''
          const setA = new Set(tokenize(q))
          const setB = new Set(tokenize(candQ))
          let inter = 0
          for (const t of setA) if (setB.has(t)) inter++
          const union = setA.size + setB.size - inter
          const sim = union > 0 ? inter / union : 0
          if (sim >= cfg.upsertThreshold) overwriteRel = hits[0].path // 形如 answers/<ts>.md
        }
      }
    } catch {
      // 查重失败不阻塞，退化为新建
    }

    // 1. 写 wiki/answers/<timestamp>.md（frontmatter + 正文）
    // - 命中相似旧问题 → 复用其路径（覆盖更新）
    // - 否则按当前时间戳新建
    const answerRel = overwriteRel || `answers/${tsFile}.md`
    const answerAbs = path.join(answersDir, path.basename(answerRel))
    const refsYaml = (refs || []).map(r => `  - "${r.replace(/"/g, '\\"')}"`).join('\n')
    const md = `---
question: "${String(q).replace(/"/g, '\\"')}"
answered_at: "${localISOString(now)}"
refs:
${refsYaml || '  []'}
---

# ${String(q)}

${String(a)}
`
    await fs.writeFile(answerAbs, md, 'utf-8')

    // 2. 更新 wiki/index.md（追加「## 问答」节 + 链接）
    // - 覆盖模式（overwriteRel != null）跳过：旧链接已存在，避免重复
    if (!overwriteRel) {
      const indexAbs = path.join(wikiDir, 'index.md')
      const indexLink = `- [${q}](${answerRel})\n`
      let indexExists = true
      try {
        await fs.access(indexAbs)
      } catch {
        indexExists = false
      }
      if (!indexExists) {
        const init = `# Wiki Index\n\n## 问答\n\n${indexLink}`
        await fs.writeFile(indexAbs, init, 'utf-8')
      } else {
        // 已有 index.md：在「## 问答」节后追加（无该节则创建并追加）
        const raw = await fs.readFile(indexAbs, 'utf-8')
        if (/## 问答/.test(raw)) {
          // 在「## 问答」段尾追加（找到下一个 ## 或文件末尾）
          const appended = raw.replace(/(## 问答\n[\s\S]*?)(?=\n## |\n*$)/, `$1${indexLink}`)
          await fs.writeFile(indexAbs, appended, 'utf-8')
        } else {
          // 没「## 问答」节 → 追加新节
          await fs.appendFile(indexAbs, `\n## 问答\n\n${indexLink}`, 'utf-8')
        }
      }
    }

    // 3. 加 log（schema §4 格式）
    const logAbs = path.join(wikiDir, 'log.md')
    const subject = String(q).slice(0, 30)
    const logLine = `## [${tsLog}] answer | ${subject}\n`
    try {
      await fs.access(logAbs)
      await fs.appendFile(logAbs, logLine, 'utf-8')
    } catch {
      await fs.writeFile(logAbs, logLine, 'utf-8')
    }

    // 4. 知识库刷新：重建 answer 独立索引并持久化（替换旧的「不重建 BM25」）
    const idx = await loadIndex(current.path)
    await this._rebuildAnswerBM25(idx, current)
    await saveIndex(current.path, idx)

    // 5. Task 6.6 (P6 健壮性)：末尾尝试轮转 log.md
    // - 失败不阻塞 recordAnswer 主流程（log 轮转是后台维护，不影响问答回填）
    // - rotateLog 内部已处理 log.md 不存在 / 未达阈值
    await this._maybeRotateLog()

    return { status: 'ok', answerPath: answerRel }
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
module.exports = { WikiEngine, SINGLE_SEGMENT_MAX_SIZE, TABLE_MAX_ROWS, RELEVANCE_THRESHOLD_HIGH, DEFAULT_CONTEXT_LINES, SUMMARY_MAX_CHARS, MAX_CONCURRENT, MAX_TOTAL, SUMMARIZE_TIMEOUT_MS, BATCH_TIMEOUT_MS }
