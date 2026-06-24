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
const { WorkspaceError } = require('./WorkspaceError')
const reader = require('./readers')
const { loadIndex, saveIndex } = require('./index-store')
const { queryBM25, buildBM25 } = require('./bm25')
const { tokenize } = require('./tokenizer')
const { tokenizeQuery, scoreSegment, computeIdf } = require('./relevance')

// Task 2 (readPage relevance filtering): 300KB 输出保护
const MAX_OUTPUT_SIZE = 300 * 1024

// Task 3: 段落切分常量
const SINGLE_SEGMENT_MAX_SIZE = 20 * 1024  // 20KB
const TABLE_MAX_ROWS = 500

// Task 4: 相关性过滤常量
const RELEVANCE_THRESHOLD_HIGH = 0.5
const DEFAULT_CONTEXT_LINES = 5

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
  }

  // Task 2.1: 原子性 ingest (P2a 升级)
  // - 所有目标文件先在 .tmp/ingest-<uuid>/ 下准备
  // - 校验后通过 fs.rename 一次性提交（POSIX 原子操作）
  // - 任一阶段失败 → 清理 .tmp/，wiki/ 不动
  // - 中文文件名加 FNV-1a(filename) 前 6 位短后缀（spec §4.10）
  // - IngestResult.bm25TokensAdded 占位 0（Task 2.5 接 BM25 后填实际值）
  async ingest({ filename }) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    const startTime = Date.now()

    const sourcePath = path.posix.join(current.path, filename)
    const crypto = require('crypto')
    const uuid = crypto.randomUUID()
    const tmpDir = path.join(current.path, 'wiki', '.tmp', `ingest-${uuid}`)
    // FNV-1a 32-bit（与前端 src/renderer/utils/workspaceFile.js toSlug 保持完全一致）
    // 原因：跨平台同步实现，避免 SHA-1 Web Crypto 异步 API 问题
    function fnv1a32(str) {
      const bytes = Buffer.from(str, 'utf-8')
      let h = 0x811c9dc5
      for (const b of bytes) {
        h = h ^ b
        h = Math.imul(h, 0x01000193)
      }
      return h >>> 0
    }

    try {
      // ===== 1. 准备阶段：在 .tmp/ 下生成所有目标文件 =====
      await fs.mkdir(tmpDir, { recursive: true })

      // 1a. 校验源文件存在
      try {
        await fs.access(sourcePath)
      } catch {
        throw new WorkspaceError('FILE_NOT_FOUND', `${filename} 不存在`, false)
      }

      // 1b. 读全文
      let content, metadata
      try {
        const result = await reader.read(sourcePath)
        content = result.content
        metadata = result.metadata
      } catch (err) {
        if (err instanceof WorkspaceError) throw err
        // reader 调度层抛的普通 Error（Unsupported file type） → 包装为 READ_FAIL
        throw new WorkspaceError('READ_FAIL', err.message, false, err)
      }

      // 1c. slug 化（spec §4.10：含中文的文件名 → 追加 FNV-1a(filename) 前 6 位 hex）
      const baseName = path.parse(filename).name
      const slugBase = baseName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w一-龥-]/g, '')
      const hasChinese = /[一-龥]/.test(baseName)
      const slug = hasChinese
        ? `${slugBase}-${fnv1a32(filename).toString(16).padStart(8, '0').substring(0, 6)}`
        : slugBase

      // 1d. 并行执行：KG 提取 + 摘要生成
      // - existingPages 从 index.bm25Index.docLengths 推导（wiki 页面列表），不是 index.files
      // - 任一失败不影响另一个（Promise.allSettled）
      const _idxForExistingPages = await loadIndex(current.path)
      const wikiFiles = Object.keys(_idxForExistingPages.bm25Index?.docLengths || {})
      const existingPages = wikiFiles.map(f => ({
        title: path.parse(f).name,
        path: `sources/${f}`
      }))

      const [kgResultSettled, summaryResultSettled] = await Promise.allSettled([
        this.kgExtractor
          ? this.kgExtractor.extract(content, filename)
          : Promise.resolve(null),
        this.summaryExtractor
          ? this.summaryExtractor.extract(content, filename, existingPages)
          : Promise.resolve(null)
      ])

      const kgResult = kgResultSettled.status === 'fulfilled' ? kgResultSettled.value : null
      const summaryResult = summaryResultSettled.status === 'fulfilled' ? summaryResultSettled.value : null

      // 1d-kg. Task 5.2 (P5.2)：在 .tmp/ 阶段准备 kg/sources/<slug>.json
      // - 调 kgExtractor.extract(content, filename) 提取实体关系
      // - quality:high → 写 .tmp/kg/sources/<slug>.json（提交阶段一起 rename）
      // - quality:low / extractor 抛错 → 降级，不写 kg/，不污染 graph.json
      // - 不注入 kgExtractor → 跳过此步骤（向后兼容）
      // - Task 5.3 (mergeInto) 会在 ingest 流程的提交后做，不在 .tmp/ 阶段
      let kgResultAbs = null    // 用于提交阶段 rename
      if (kgResult && kgResult.quality === 'high') {
        // 准备 .tmp/ingest-<uuid>/kg/sources/<slug>.json
        const kgSourcesDir = path.join(tmpDir, 'kg', 'sources')
        await fs.mkdir(kgSourcesDir, { recursive: true })
        const kgTargetRel = `kg/sources/${slug}.json`
        kgResultAbs = path.join(tmpDir, kgTargetRel)
        await fs.writeFile(kgResultAbs, JSON.stringify(kgResult, null, 2), 'utf-8')
        // 校验：JSON 大小必须 > 0
        const kgStat = await fs.stat(kgResultAbs)
        if (kgStat.size === 0) {
          throw new WorkspaceError('ATOMIC_FAIL', 'kg json 大小为 0', true)
        }
      }

      // 1e. 预计算 sections（复用 _splitIntoSegments）和生成 .md frontmatter
      // - 用 gray-matter.stringify 写 frontmatter（不用字符串拼接）
      // - entities 从 kgResult 填充（不写空数组）
      const sourcesDir = path.join(tmpDir, 'sources')
      await fs.mkdir(sourcesDir, { recursive: true })
      const targetRel = `sources/${slug}.md`
      const targetAbs = path.join(tmpDir, targetRel)
      const nowIso = new Date().toISOString()
      const sections = this.computeSections(content)
      const fmObj = {
        type: 'wiki-source-page',
        title: slug,
        source: filename,
        tags: summaryResult?.tags || [],
        ingested_at: nowIso,
        updated_at: nowIso,
        quality: 'high',
        summary: summaryResult?.summary || null,
        keyPoints: summaryResult?.keyPoints || [],
        confidence: summaryResult?.confidence ?? 0.85,
        supersedes: [],
        entities: kgResult?.entities?.map(e => e.name) || [],
        concepts: kgResult?.entities?.filter(e => e.type === 'Concept' || e.type === 'Property').map(e => e.name) || [],
        relatedPages: summaryResult?.relatedLinks || [],
        sections_version: 1,
        sections
      }
      const md = require('gray-matter').stringify(content, fmObj)
      await fs.writeFile(targetAbs, md.replace(/\r\n/g, '\n'), 'utf-8')
      // 1f. v4.9.4 (P2a follow-up I-1)：ingest→index 桥接完成
      //     提交阶段后立即 buildBM25 + saveIndex，下次 search 走持久化索引
      //     干掉 Task 2.6 search 内的 fallback 临时方案

      // ===== 2. 校验阶段：目标文件必须非空 =====
      const stat = await fs.stat(targetAbs)
      if (stat.size === 0) {
        throw new WorkspaceError('ATOMIC_FAIL', '目标文件大小为 0', true)
      }

      // ===== 3. 提交阶段：原子 rename =====
      const finalDir = path.join(current.path, 'wiki', 'sources')
      await fs.mkdir(finalDir, { recursive: true })
      await fs.rename(targetAbs, path.join(finalDir, `${slug}.md`))
      // Task 5.2 (P5.2)：KG 文件同步 rename 到 wiki/kg/sources/<slug>.json
      // - 只有质量为 high 时才写了 kgResultAbs
      // - 和 .md 一起在提交阶段一次性 rename（如果前面抛错，.tmp/ 清理时一并删掉）
      if (kgResultAbs) {
        const finalKgDir = path.join(current.path, 'wiki', 'kg', 'sources')
        await fs.mkdir(finalKgDir, { recursive: true })
        await fs.rename(kgResultAbs, path.join(finalKgDir, `${slug}.json`))
      }

      // Task 5.3 (P5.3)：把新提取的三元组合并到全局 graph.json
      // - 在 .md / kg/sources/<slug>.json 都原子 rename 后再 mergeInto
      //   （任何前序失败 → .tmp/ 清理，graph.json 不动 → 保持原子性）
      // - mergeInto 内部已含 _checkSize（kg-merge.js）；saveGraph 失败不污染 ingest 主流程
      let kgMergeResult = null
      if (this.kgExtractor && kgResult && kgResult.quality === 'high') {
        try {
          const { mergeInto } = require('./kg-merge')
          const oldGraph = await this.kgExtractor.loadGraph(current.path)
          const { graph: newGraph, conflicts } = mergeInto(oldGraph, kgResult, filename)
          await this.kgExtractor.saveGraph(current.path, newGraph)
          kgMergeResult = {
            mergedEntities: kgResult.entities.length,
            mergedRelations: kgResult.relations.length,
            conflictsDetected: conflicts.length
          }
        } catch (err) {
          // KG 合并失败不影响 ingest 主流程（spec §4.13：KG 失败降级 quality: low）
          const code = err instanceof WorkspaceError ? err.code : 'KG_EXTRACT_FAIL'
          kgMergeResult = { error: code, message: err.message }
        }
      }

      // ===== 4. 清理 .tmp/ =====
      await fs.rm(tmpDir, { recursive: true, force: true })

      // ===== 5. v4.9.4 (P2a follow-up I-1)：更新 .workspace-index.json =====
      // 5a. 读旧 index
      const index = await loadIndex(current.path)
      // 5b. 更新 files 记录（hash / mtime / size / wikiPage / lastIngestAt / quality / ingestVersion）
      const sourceStat = await fs.stat(sourcePath)
      const sourceHash = require('crypto')
        .createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex')
      index.files[filename] = {
        hash: `sha256:${sourceHash}`,
        mtime: Math.floor(sourceStat.mtimeMs),
        size: sourceStat.size,
        wikiPage: targetRel,
        lastIngestAt: Date.now(),
        quality: 'high',
        ingestVersion: 2
      }
      index.updatedAt = new Date().toISOString()
      // 5c. 重新构建 BM25 索引（v1 简单实现：全量 rebuild + add new doc）
      const allDocs = []
      for (const [name, info] of Object.entries(index.files)) {
        const absSrc = path.posix.join(current.path, name)
        try {
          const c = await fs.readFile(absSrc, 'utf-8')
          allDocs.push({ path: info.wikiPage, content: c })
        } catch {
          // 源文件不存在（已删除？）跳过，不影响其他 doc
        }
      }
      const tokensAdded = tokenize(content).length
      index.bm25Index = buildBM25(allDocs)
      // 5d. 写回 .workspace-index.json（v4.9.4 M-3：saveIndex 失败 → WRITE_FAIL 而非 ATOMIC_FAIL）
      try {
        await saveIndex(current.path, index)
      } catch (err) {
        throw new WorkspaceError('WRITE_FAIL', `保存 .workspace-index.json 失败: ${err.message}`, true, err)
      }

      return {
        status: 'ok',
        pagesCreated: [targetRel],
        pagesUpdated: [],
        refsUpdated: 0,
        bm25TokensAdded: tokensAdded,
        durationMs: Date.now() - startTime,
        kgMerge: kgMergeResult
      }
    } catch (err) {
      // 任何失败：清理 .tmp/ingest-<uuid>/，并尝试清理空 .tmp/ 父目录（保持原子性测试不变量）
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      // 尝试删空 .tmp/ 父目录（不报错，因其他 ingest 可能正在用）
      const tmpParent = path.join(current.path, 'wiki', '.tmp')
      try {
        const entries = await fs.readdir(tmpParent)
        if (entries.length === 0) {
          await fs.rmdir(tmpParent)
        }
      } catch {
        // .tmp/ 不存在或不可读 → 忽略
      }
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('ATOMIC_FAIL', err.message, true, err)
    }
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
    const startTime = Date.now()
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
    const { data: frontmatter, content } = require('gray-matter')(raw)

    const startMs = Date.now()

    // 无 query → 老逻辑 + 300KB 截断
    if (!options.query || !options.query.trim()) {
      return {
        content: this._truncateToSize(content, MAX_OUTPUT_SIZE),
        frontmatter,
        mtime: stat.mtimeMs,
        size: stat.size,
        stats: { mode: 'full', query: null, elapsedMs: Date.now() - startMs }
      }
    }

    // 4 阶段智能分块
    const segments = this._splitIntoSegments(content)
    const queryTokens = tokenizeQuery(options.query)
    const segmentTokensList = segments.map(seg => new Set(tokenize(seg.text)))
    const idfMap = computeIdf(segmentTokensList)
    const scored = segments.map((seg, i) => ({
      ...seg,
      tokens: segmentTokensList[i],
      score: scoreSegment(segmentTokensList[i], queryTokens, idfMap)
    }))
    const decided = this._decideMode(scored, options.contextLines ?? 5)
    const { content: filtered, stats } = await this._assemble(decided, this.deepseekService, options.query)

    return {
      content: filtered,
      frontmatter,
      mtime: stat.mtimeMs,
      size: stat.size,
      stats: { mode: 'filtered', ...stats, query: options.query, elapsedMs: Date.now() - startMs }
    }
  }

  // Task 3: 段落切分 — 将 markdown 内容切分为段落数组
  // 规则：
  //   1. 标题 (^#{1,6} ) 开始新段
  //   2. 空行分隔段落
  //   3. 表格行 (^| .* |$) 连续视为原子段，不被空行切开
  //   4. 表格 > 500 行 → 强制切，每段带 header+separator 前缀
  //   5. 非表格段 > 20KB → 按行强制切分
  // 返回: [{ id, level, text, startLine, endLine, isTable?, tableHeader? }]
  _splitIntoSegments(content) {
    if (!content || !content.trim()) return []

    // 1. 解析为行数组（带行号）
    const lines = this._parseLineInfo(content)

    // 2. 预识别表格块
    const tableRegions = this._detectTableRegions(lines)

    // 3. 按标题切分段落
    const headingSections = this._splitByHeadings(lines, tableRegions)

    // 4. 各段再按空行切分
    const afterBlankSplit = []
    for (const section of headingSections) {
      afterBlankSplit.push(
        ...this._splitSectionByBlankLines(section.lines, section.startLine, section.level)
      )
    }

    // 5. 组装最终结果 + 强制切分
    const HEADING_RE = /^#{1,6} /
    const segments = []
    let segId = 0
    for (const seg of afterBlankSplit) {
      const isTable = seg.lines.length > 0 && this._isTableLine(seg.lines[0].text)
      const rawText = seg.lines.map(l => l.text).join('\n')

      // 修正 level：只有真正以标题开头的段才有 level > 0
      let effectiveLevel = seg.level
      if (!isTable && seg.lines.length > 0) {
        if (HEADING_RE.test(seg.lines[0].text)) {
          effectiveLevel = seg.lines[0].text.match(/^(#{1,6})/)[1].length
        } else {
          effectiveLevel = 0
        }
      }

      if (isTable) {
        // 表格段：> 500 行 → 强制切
        if (seg.lines.length > TABLE_MAX_ROWS) {
          // 提取 header（第 1 行）+ separator（第 2 行）
          const headerLine = seg.lines[0]
          const separatorLine = seg.lines[1]
          const tableHeader = headerLine.text + '\n' + separatorLine.text
          const dataLines = seg.lines.slice(2)

          // 按 TABLE_MAX_ROWS 切分（每块含 header+separator+数据行）
          // 每块最大数据行 = TABLE_MAX_ROWS - 2（header+separator 占 2 行）
          const chunkSize = TABLE_MAX_ROWS - 2
          for (let i = 0; i < dataLines.length; i += chunkSize) {
            const chunk = dataLines.slice(i, i + chunkSize)
            const allLines = [headerLine, separatorLine, ...chunk]
            segments.push({
              id: segId++,
              level: 0,
              text: tableHeader + '\n' + chunk.map(l => l.text).join('\n'),
              startLine: headerLine.lineNumber,
              endLine: chunk[chunk.length - 1].lineNumber,
              isTable: true,
              tableHeader
            })
          }
        } else {
          // 正常表格段（≤ 500 行）
          segments.push({
            id: segId++,
            level: 0,
            text: rawText,
            startLine: seg.lines[0].lineNumber,
            endLine: seg.lines[seg.lines.length - 1].lineNumber,
            isTable: true
          })
        }
      } else {
        // 非表格段：> 20KB → 按行强制切
        if (Buffer.byteLength(rawText, 'utf-8') > SINGLE_SEGMENT_MAX_SIZE) {
          const lineChunks = this._splitLargeSegmentByLines(seg.lines)
          for (const chunk of lineChunks) {
            segments.push({
              id: segId++,
              level: effectiveLevel,
              text: chunk.lines.map(l => l.text).join('\n'),
              startLine: chunk.lines[0].lineNumber,
              endLine: chunk.lines[chunk.lines.length - 1].lineNumber
            })
          }
        } else {
          segments.push({
            id: segId++,
            level: effectiveLevel,
            text: rawText,
            startLine: seg.lines[0].lineNumber,
            endLine: seg.lines[seg.lines.length - 1].lineNumber
          })
        }
      }
    }

    return segments
  }

  // 辅助方法：解析内容为带行号的行数组
  _parseLineInfo(content) {
    const rawLines = content.split('\n')
    const lines = []
    for (let i = 0; i < rawLines.length; i++) {
      lines.push({ lineNumber: i, text: rawLines[i] })
    }
    return lines
  }

  // 辅助方法：检测表格区域（连续 | 行的区间）
  // 返回 Set<lineNumber>
  _detectTableRegions(lines) {
    const tableLines = new Set()
    let i = 0
    while (i < lines.length) {
      if (this._isTableLine(lines[i].text)) {
        const start = i
        while (i < lines.length && this._isTableLine(lines[i].text)) {
          tableLines.add(lines[i].lineNumber)
          i++
        }
      } else {
        i++
      }
    }
    return tableLines
  }

  // 辅助方法：判断是否为表格行
  _isTableLine(text) {
    return /^\|.*\|$/.test(text)
  }

  // 辅助方法：按标题切分
  // headingSections: [{ lines, startLine, level }]
  _splitByHeadings(lines, tableLines) {
    const HEADING_RE = /^#{1,6} /
    const sections = []
    let currentLines = []
    let currentLevel = 0
    let currentStartLine = lines.length > 0 ? lines[0].lineNumber : 0

    for (const line of lines) {
      // 行在表格内 → 不作为标题切分
      if (tableLines.has(line.lineNumber)) {
        currentLines.push(line)
        continue
      }

      if (HEADING_RE.test(line.text)) {
        // 保存之前的段落
        if (currentLines.length > 0) {
          sections.push({
            lines: currentLines,
            startLine: currentStartLine,
            level: currentLevel
          })
        }
        // 新标题段开始
        currentLines = [line]
        currentLevel = line.text.match(/^(#{1,6})/)[1].length
        currentStartLine = line.lineNumber
      } else {
        currentLines.push(line)
      }
    }

    // 最后一段
    if (currentLines.length > 0) {
      sections.push({
        lines: currentLines,
        startLine: currentStartLine,
        level: currentLevel
      })
    }

    return sections
  }

  // 辅助方法：按空行切分段落内的内容
  // 空行不归入任何段（与 headingSection 的 level 一起传递）
  _splitSectionByBlankLines(lines, sectionStartLine, level) {
    const BLANK_RE = /^\s*$/
    const segments = []
    let currentLines = []

    for (const line of lines) {
      // 表格行不被空行切开
      if (this._isTableLine(line.text)) {
        currentLines.push(line)
        continue
      }

      if (BLANK_RE.test(line.text)) {
        // 空行 → 切分点
        if (currentLines.length > 0) {
          segments.push({
            lines: currentLines,
            startLine: currentLines[0].lineNumber,
            level
          })
          currentLines = []
        }
      } else {
        currentLines.push(line)
      }
    }

    // 最后一段
    if (currentLines.length > 0) {
      segments.push({
        lines: currentLines,
        startLine: currentLines[0].lineNumber,
        level
      })
    }

    return segments
  }

  // 辅助方法：按行切分大段落（> 20KB）
  // 每行作为独立子段
  _splitLargeSegmentByLines(lines) {
    const chunks = []
    let currentLines = []
    let currentSize = 0

    for (const line of lines) {
      const lineSize = Buffer.byteLength(line.text + '\n', 'utf-8')
      if (currentSize + lineSize > SINGLE_SEGMENT_MAX_SIZE && currentLines.length > 0) {
        chunks.push({ lines: currentLines })
        currentLines = []
        currentSize = 0
      }
      currentLines.push(line)
      currentSize += lineSize
    }

    if (currentLines.length > 0) {
      chunks.push({ lines: currentLines })
    }

    return chunks
  }

  // Task 2: 截断 content 至 maxBytes 以内（UTF-8 边界安全）
  // 修复 brief 中的无限循环 bug：while 循环的 suffix 含 \n，导致 lastNewline
  // 反复命中 suffix 内的 \n 而非正文内容。改为：先裁剪内容，再追加 suffix。
  _truncateToSize(content, maxBytes) {
    if (Buffer.byteLength(content, 'utf-8') <= maxBytes) return content
    const slice = content.slice(0, Math.floor(maxBytes * 1.3))
    const lastParagraph = slice.lastIndexOf('\n\n')
    const truncationSuffix = '\n\n[... 已截断（原始内容 > 300KB）...]'
    const suffixBytes = Buffer.byteLength(truncationSuffix, 'utf-8')
    let result
    if (lastParagraph > maxBytes * 0.5) {
      result = slice.slice(0, lastParagraph)
    } else {
      result = slice
    }
    // UTF-8 二次校验：逐步缩短内容直到 + suffix 不超限
    while (Buffer.byteLength(result, 'utf-8') + suffixBytes > maxBytes) {
      const lastNewline = result.lastIndexOf('\n')
      if (lastNewline <= 0) break
      result = result.slice(0, lastNewline)
    }
    return result + truncationSuffix
  }

  // Task 4: _decideMode — 根据分数和上下文行数决定每段是 full 还是 summary
  // 步骤：
  //   1. 标记命中段（score > 0.5 → full）
  //   2. 扩展上下文（前后 ±contextLines 行，跨段合并到 full 区间）
  //   3. 剩余段标 summary
  // 输入: [{ id, level, text, startLine, endLine, isTable?, tableHeader?, tokens, score }]
  // 输出: [{ ...segment, mode: 'full' | 'summary', score }]
  _decideMode(scored, contextLines = DEFAULT_CONTEXT_LINES) {
    if (!scored || scored.length === 0) return []

    // 1. 收集命中段的扩展区间 [startLine - contextLines, endLine + contextLines]
    const hitRanges = []
    for (const seg of scored) {
      if (seg.score > RELEVANCE_THRESHOLD_HIGH) {
        hitRanges.push({
          start: seg.startLine - contextLines,
          end: seg.endLine + contextLines
        })
      }
    }

    // 2. 合并重叠区间（先按 start 排序，再扫描合并）
    hitRanges.sort((a, b) => a.start - b.start)
    const mergedRanges = []
    for (const range of hitRanges) {
      if (mergedRanges.length > 0) {
        const last = mergedRanges[mergedRanges.length - 1]
        if (range.start <= last.end + 1) {
          // 重叠或相邻 → 合并
          last.end = Math.max(last.end, range.end)
          continue
        }
      }
      mergedRanges.push({ start: range.start, end: range.end })
    }

    // 3. 对每个段，判断是否与合并区间重叠
    return scored.map(seg => {
      let mode = 'summary'
      // 命中段本身 → full
      if (seg.score > RELEVANCE_THRESHOLD_HIGH) {
        mode = 'full'
      } else {
        // 非命中段：检查是否与合并区间重叠
        for (const range of mergedRanges) {
          if (seg.endLine >= range.start && seg.startLine <= range.end) {
            mode = 'full'
            break
          }
        }
      }
      return { ...seg, mode, score: seg.score }
    })
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

    // Task 3.4 (P3)：两边分别查，合并排序后截 topK
    const wikiHits = queryBM25(wikiIndex, query, topK)
    const chatHits = queryBM25(chatIndex, query, topK)

    const wikiTagged = wikiHits.map(h => ({ ...h, sourceType: 'wiki' }))
    const chatTagged = chatHits.map(h => ({ ...h, sourceType: 'chatHistory' }))

    const merged = wikiTagged.concat(chatTagged)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    // 生成 snippet
    const queryTokens = new Set(tokenize(query))

    const enriched = []
    for (const hit of merged) {
      const absPath = path.posix.join(current.path, 'wiki', hit.path)
      let content = ''
      try {
        const raw = await fs.readFile(absPath, 'utf-8')
        // 去掉 frontmatter
        const m = raw.match(/^---\n[\s\S]+?\n---\n([\s\S]*)$/)
        content = m ? m[1] : raw
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

      enriched.push({ ...hit, title: hit.path, snippet })
    }

    return enriched
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
      const { data: frontmatter, content } = require('gray-matter')(raw)
      const presentKeys = Object.keys(frontmatter || {})
      const missing = REQUIRED_FM.filter(k => !presentKeys.includes(k))
      if (missing.length > 0) {
        missingFrontmatter.push({ path: relPath, missing })
      }
      pageInfos.push({ relPath, frontmatter, content, wikiMtime: stat.mtimeMs })
    }

    // 3. orphans / missingCrossRefs：扫每个页正文的 [[ref]]
    const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g
    const referencedBy = new Map()  // ref → Set<relPath>
    for (const info of pageInfos) {
      const links = new Set()
      let m
      const re = new RegExp(WIKI_LINK_RE.source, 'g')
      while ((m = re.exec(info.content)) !== null) {
        links.add(m[1].trim())
      }
      for (const ref of links) {
        if (!referencedBy.has(ref)) referencedBy.set(ref, new Set())
        referencedBy.get(ref).add(info.relPath)
      }
    }
    // orphans：pageInfos 中没有任何 [[ref]] 入链的页
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
      scannedAt: new Date().toISOString()
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

    // 1. 写 wiki/answers/<timestamp>.md（frontmatter + 正文）
    const answersDir = path.join(wikiDir, 'answers')
    await fs.mkdir(answersDir, { recursive: true })
    const answerRel = `answers/${tsFile}.md`
    const answerAbs = path.join(answersDir, `${tsFile}.md`)
    const refsYaml = (refs || []).map(r => `  - "${r.replace(/"/g, '\\"')}"`).join('\n')
    const md = `---
question: "${String(q).replace(/"/g, '\\"')}"
answered_at: "${now.toISOString()}"
refs:
${refsYaml || '  []'}
---

# ${String(q)}

${String(a)}
`
    await fs.writeFile(answerAbs, md, 'utf-8')

    // 2. 更新 wiki/index.md（追加「## 问答」节 + 链接）
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

    // 4. 不重建 BM25（answer 文档不入索引）

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

  /**
   * 预计算 sections 元数据（复用 _splitIntoSegments）
   * 强制约束：必须从 _splitIntoSegments 复用 segments，禁止自行重新切分
   * @param {string} content - 正文（不含 frontmatter）
   * @returns {Array<{id, heading, startLine, endLine}>}
   */
  computeSections(content) {
    const segments = this._splitIntoSegments(content)
    return segments.map(seg => ({
      id: seg.id,
      heading: this._extractHeading(seg),
      startLine: seg.startLine,
      endLine: seg.endLine
    }))
  }

  /**
   * 从段落提取 heading（第一个标题行，或空字符串）
   */
  _extractHeading(seg) {
    if (!seg.lines || seg.lines.length === 0) return ''
    const firstLine = seg.lines[0].text || ''
    const headingMatch = firstLine.match(/^#{1,6}\s+(.+)/)
    return headingMatch ? headingMatch[1].trim() : ''
  }
}

module.exports = { WikiEngine, SINGLE_SEGMENT_MAX_SIZE, TABLE_MAX_ROWS, RELEVANCE_THRESHOLD_HIGH, DEFAULT_CONTEXT_LINES, SUMMARY_MAX_CHARS, MAX_CONCURRENT, MAX_TOTAL, SUMMARIZE_TIMEOUT_MS, BATCH_TIMEOUT_MS }