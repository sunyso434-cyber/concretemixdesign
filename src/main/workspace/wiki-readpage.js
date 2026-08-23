// readPage 读取管线方法集（从 WikiEngine.js 拆分，行为不变）
// 通过 WikiEngine.prototype 挂载；经 this 访问 workspace/_splitIntoSegments/_summarizeHeuristic/
// _batchSummarize/_assemble/_decideMode 及主文件回引的 localISOString。
// 依赖与主文件头部对齐。

const fs = require('fs').promises
const path = require('path')
const matter = require('gray-matter')
const { WorkspaceError } = require('./WorkspaceError')
const wikiHeadings = require('./wiki-headings')
const { loadIndex, saveIndex } = require('./index-store')
const { tokenize } = require('./tokenizer')
const { tokenizeQuery, scoreSegment, computeIdf } = require('./relevance')
const wikiSegmentation = require('./WikiSegmentation')

// 单一来源在此，主文件与 lint-grep 回引
const MAX_OUTPUT_SIZE = 300 * 1024
const SUMMARY_MAX_CHARS = 500

  // Task 2.7: readPage 加固 - 加 SIZE_EXCEEDED 检查（> 5MB 抛错，避免内存爆）
  // - 工作区未打开 → NOT_OPEN（不 retry）
  // - 路径穿越防护 → PATH_INVALID
  // - 文件不存在 → PAGE_NOT_FOUND
  // - 文件 > 5MB → SIZE_EXCEEDED（保护内存）
  // - 成功返回 { content, frontmatter, mtime, size }（mtime/size 是数字）
  // Task 2: readPage 签名扩展 - options.query 用于后续 Task 8 相关性过滤
  // 无 query 时走老逻辑 + 300KB 截断保护 + stats 返回
  async function readPage(wikiPath, options = {}) {
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
  function _readPageByLines(content, fm, stat, offset, limit) {
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
  async function _readPageFull(content, fm, stat, query, contextLines) {
    const startMs = Date.now()
    if (!query || !query.trim()) {
      return {
        content: wikiSegmentation.truncateToSize(content, MAX_OUTPUT_SIZE),
        frontmatter: fm,
        mtime: stat.mtimeMs,
        size: stat.size,
        stats: { mode: 'full', query: null, elapsedMs: Date.now() - startMs }
      }
    }
    const segments = wikiSegmentation.splitIntoSegments(content)
    const queryTokens = tokenizeQuery(query)
    const segmentTokensList = segments.map(seg => new Set(tokenize(seg.text)))
    const idfMap = computeIdf(segmentTokensList)
    const scored = segments.map((seg, i) => ({
      ...seg,
      tokens: segmentTokensList[i],
      score: scoreSegment(segmentTokensList[i], queryTokens, idfMap)
    }))
    const decided = wikiSegmentation.decideMode(scored, contextLines)
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
  function _readPageRelevant(content, fm, stat, query, contextLines) {
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
    const content_out = wikiSegmentation.truncateToSize(kept.join('\n\n'), 10 * 1024)

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
  function _fullFiltered(content, fm, stat, query, contextLines) {
    const segments = wikiSegmentation.splitIntoSegments(content)
    const queryTokens = tokenizeQuery(query)
    const segmentTokensList = segments.map(seg => new Set(tokenize(seg.text)))
    const idfMap = computeIdf(segmentTokensList)
    const scored = segments.map((seg, i) => ({
      ...seg,
      score: scoreSegment(segmentTokensList[i], queryTokens, idfMap)
    }))
    const decided = wikiSegmentation.decideMode(scored, contextLines)
    const parts = decided.map(seg =>
      seg.mode === 'full' ? seg.text : this._summarizeHeuristic(seg.text)
    )
    const content_out = wikiSegmentation.truncateToSize(parts.join('\n\n'), MAX_OUTPUT_SIZE)
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

module.exports = { readPage, _readPageByLines, _readPageFull, _readPageRelevant, _fullFiltered, MAX_OUTPUT_SIZE, SUMMARY_MAX_CHARS }
