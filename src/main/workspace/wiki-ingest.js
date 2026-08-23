// ingest 导入管线方法集（从 WikiEngine.js 拆分，行为不变）
// 通过 WikiEngine.prototype 挂载；方法体经 this 访问 workspace/deepseekService/kgExtractor/
// summaryExtractor 及主文件的 _rebuildBM25/_splitIntoSegments/computeSections 等。
// 依赖的 pathGuard/crypto/kg-merge 沿用原方法的惰性 require。
// 依赖与主文件头部对齐（多出的无害，缺了会运行时 ReferenceError）
const fs = require('fs').promises
const path = require('path')
const matter = require('gray-matter')
const { WorkspaceError } = require('./WorkspaceError')
const reader = require('./readers')
const wikiSegmentation = require('./WikiSegmentation')
const { loadIndex, saveIndex } = require('./index-store')
const { queryBM25, buildBM25 } = require('./bm25')
const { tokenize } = require('./tokenizer')
const { tokenizeQuery, scoreSegment, computeIdf } = require('./relevance')

// 经 this 调用的跨域方法（由 WikiEngine 原型提供）：_splitIntoSegments / computeSections /
// _rebuildAnswerBM25 / _summarizeHeuristic / _batchSummarize 等

// 本地时间 ISO 格式（北京时间 UTC+8）——单一来源在此，主文件回引（ingest/lint/recordAnswer 多域共用）
function localISOString(date = new Date()) {
  const tzOffset = -date.getTimezoneOffset()
  const tzSign = tzOffset >= 0 ? '+' : '-'
  const tzH = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0')
  const tzM = String(Math.abs(tzOffset) % 60).padStart(2, '0')
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0') + 'T' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0') + ':' +
    String(date.getSeconds()).padStart(2, '0') + '.' +
    String(date.getMilliseconds()).padStart(3, '0') +
    tzSign + tzH + ':' + tzM
}


function fnv1a32(str) {
  const bytes = Buffer.from(str, 'utf-8')
  let h = 0x811c9dc5
  for (const b of bytes) {
    h = h ^ b
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

  /**
   * 根据文件名生成 wiki slug（spec §4.10：含中文的文件名追加 FNV-1a(filename) 前 6 位 hex）
   * @param {string} filename - 相对工作区的源文件名
   * @returns {string}
   */
function _buildSlug(filename) {
    const baseName = path.parse(filename).name
    const slugBase = baseName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w一-龥-]/g, '')
    const hasChinese = /[一-龥]/.test(baseName)
    return hasChinese
      ? `${slugBase}-${fnv1a32(filename).toString(16).padStart(8, '0').substring(0, 6)}`
      : slugBase
  }

  /**
   * v2026-06-29：BM25 全量重建（带串行锁）
   * - 多个并发 ingest 不会重叠执行 BM25 rebuild 部分
   * - 当前 ingest 的文件直接用已读的 content，避免重复读盘
   * - 单文件 ingest 内存可接受，串行锁仅控制并发全量 rebuild 不叠加
   */
async function _rebuildBM25(index, current, filename, content) {
    const run = async () => {
      const allDocs = []
      for (const [name, info] of Object.entries(index.files)) {
        const absSrc = path.posix.join(current.path, name)
        try {
          const c = name === filename ? content : await fs.readFile(absSrc, 'utf-8')
          allDocs.push({ path: info.wikiPage, content: c })
        } catch {
          // 源文件不存在（已删除？）跳过，不影响其他 doc
        }
      }
      index.bm25Index = buildBM25(allDocs)
    }
    // 链式锁：then(run, run) 保证上一个失败也不影响下一个进入
    this._bm25Lock = this._bm25Lock.then(run, run)
    await this._bm25Lock
  }

  // 知识库刷新：扫 wiki/answers/*.md 全量重建 answer 独立索引
  // - 不进 index.files（answers 是直接 wiki 页，非「源文件→wiki页」映射）
  // - 原地写 index.answerBM25Index，调用方负责 saveIndex
async function _rebuildAnswerBM25(index, current) {
    const answersDir = path.join(current.path, 'wiki', 'answers')
    let entries = []
    try {
      entries = await fs.readdir(answersDir)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    const docs = []
    for (const name of entries) {
      if (!name.endsWith('.md')) continue
      try {
        const raw = await fs.readFile(path.join(answersDir, name), 'utf-8')
        const parsed = matter(raw)
        docs.push({ path: `answers/${name}`, content: parsed.content })
      } catch {
        // 单文件读失败跳过，不影响其他
      }
    }
    index.answerBM25Index = buildBM25(docs)
  }

  // Task 2.1: 原子性 ingest (P2a 升级)
  // - 所有目标文件先在 .tmp/ingest-<uuid>/ 下准备
  // - 校验后通过 fs.rename 一次性提交（POSIX 原子操作）
  // - 任一阶段失败 → 清理 .tmp/，wiki/ 不动
  // - 中文文件名加 FNV-1a(filename) 前 6 位短后缀（spec §4.10）
  // - IngestResult.bm25TokensAdded 占位 0（Task 2.5 接 BM25 后填实际值）
async function ingest({ filename }) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    const startTime = Date.now()

    // 安全（2026-08-22 审查）：filename 拼进工作区路径，收口防止 ".." 逃逸读工作区外文件
    let sourcePath
    try {
      const { resolveInside } = require('../utils/pathGuard')
      sourcePath = resolveInside(current.path, filename)
    } catch (e) {
      throw new WorkspaceError('E-PARAM-INVALID', `文件路径非法：${filename}（${e.message}）`, false)
    }
    const crypto = require('crypto')
    const uuid = crypto.randomUUID()
    const tmpDir = path.join(current.path, 'wiki', '.tmp', `ingest-${uuid}`)

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
      const slug = _buildSlug(filename)

      // 1d. 并行执行：KG 提取 + 摘要生成
      // - existingPages 从 index.bm25Index.docLengths 推导（wiki 页面列表），不是 index.files
      // - 任一失败不影响另一个（Promise.allSettled）
      if (!this.kgExtractor) console.warn('[WikiEngine.ingest] kgExtractor 未注入，跳过 KG')
      if (!this.summaryExtractor) console.warn('[WikiEngine.ingest] summaryExtractor 未注入，跳过摘要')
      const _idxForExistingPages = await loadIndex(current.path)
      const wikiFiles = Object.keys(_idxForExistingPages.bm25Index?.docLengths || {})
      // v9.1.0 补充4：bm25Index.docLengths 的 key 已经是完整 wiki 路径（如 'sources/a.md'），
      // 不能再拼 sources/ 前缀，否则 existingPages.path 变成 'sources/sources/a.md'，
      // LLM 照抄后写进 frontmatter，lint 比对不上 → 全部判定为孤儿页
      const existingPages = wikiFiles.map(f => ({
        title: path.parse(f).name,
        path: f
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

      // v9.1.0 补充4：规范化 relatedLinks 路径
      // 问题：LLM 返回的 page 可能多套了一层 sources/（如 "sources/sources/xxx.md"），
      //       导致 lint 比对时对不上，全部判定为孤儿页。
      // 修复：拿到 summaryResult 后、写入 frontmatter 前，对每条 link.page 做规范化：
      //   1. 构造合法路径集合 validPaths（来自 existingPages）
      //   2. 对每条 link.page：
      //      - 去掉多余的 sources/ 前缀（反复出现就反复去）
      //      - 规范化后不在 validPaths 里 → 丢弃
      //   3. 过滤后为空就不写 relatedPages（避免写无效关联）
      if (summaryResult && Array.isArray(summaryResult.relatedLinks)) {
        const validPaths = new Set(existingPages.map(p => p.path))
        const normalizedLinks = []
        for (const link of summaryResult.relatedLinks) {
          if (!link || typeof link.page !== 'string') continue
          let normalized = link.page.trim()
          // 去掉多余的 sources/ 前缀（最多去 3 次防死循环）
          for (let i = 0; i < 3 && normalized.startsWith('sources/sources/'); i++) {
            normalized = normalized.replace(/^sources\/sources\//, 'sources/')
          }
          // 补 .md 后缀（LLM 可能漏掉）
          if (!normalized.endsWith('.md')) {
            normalized = normalized + '.md'
          }
          // 只保留合法路径
          if (validPaths.has(normalized)) {
            normalizedLinks.push({ ...link, page: normalized })
          } else {
            console.warn(`[WikiEngine.ingest] 丢弃无效 relatedLink: ${link.page} -> 规范化为 ${normalized} 但不在已有页面列表中`)
          }
        }
        summaryResult.relatedLinks = normalizedLinks
      }

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
      const nowIso = localISOString()
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
      const md = matter.stringify(content, fmObj)
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
      const finalMdPath = path.join(finalDir, `${slug}.md`)
      // v9.1.0 补充：重新导入时目标文件可能已存在（Windows rename 不覆盖），先删除旧文件
      try {
        await fs.unlink(finalMdPath)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
      await fs.rename(targetAbs, finalMdPath)
      // Task 5.2 (P5.2)：KG 文件同步 rename 到 wiki/kg/sources/<slug>.json
      // - 只有质量为 high 时才写了 kgResultAbs
      // - 和 .md 一起在提交阶段一次性 rename（如果前面抛错，.tmp/ 清理时一并删掉）
      if (kgResultAbs) {
        const finalKgDir = path.join(current.path, 'wiki', 'kg', 'sources')
        await fs.mkdir(finalKgDir, { recursive: true })
        const finalKgPath = path.join(finalKgDir, `${slug}.json`)
        try {
          await fs.unlink(finalKgPath)
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
        }
        await fs.rename(kgResultAbs, finalKgPath)
      }

      // Task 5.3 (P5.3)：把新提取的三元组合并到全局 graph.json
      // - 在 .md / kg/sources/<slug>.json 都原子 rename 后再 mergeInto
      //   （任何前序失败 → .tmp/ 清理，graph.json 不动 → 保持原子性）
      // - mergeInto 内部已含 _checkSize（kg-merge.js）；saveGraph 失败不污染 ingest 主流程
      let kgMergeResult = null
      if (this.kgExtractor && kgResult && kgResult.quality === 'high') {
        try {
          const { mergeInto, purgeBySource } = require('./kg-merge')
          const oldGraph = await this.kgExtractor.loadGraph(current.path)
          // 知识库刷新：先清除本文件上次贡献的旧三元组，再合并新的
          const purged = purgeBySource(oldGraph, filename)
          const { graph: newGraph, conflicts } = mergeInto(purged, kgResult, filename)
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

      // ===== 4. 反向关联更新 + 清理 .tmp/ =====
      // 4a. 知识库刷新：先清悬空（本文件上次留下的反向条目），再按语义写新反向关联
      // - _purgeReverseLinks 扫所有 wiki/sources/*.md，删掉 relatedPages 里指向本文件的旧条目
      // - _updateReverseLinks 按 REVERSE_RELATION_MAP 把正向关系映射成反向关系（未知回退「被引用」）
      // - 放在 fs.rm(.tmp) 之前，避免 Windows 上 rm 异步删除时序导致 .tmp/ 残留
      const newPageRel = `sources/${slug}.md`
      await this._purgeReverseLinks(newPageRel)
      const refsUpdated = await this._updateReverseLinks(newPageRel, summaryResult?.relatedLinks || [])

      // 4b. 清理 .tmp/
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
      index.updatedAt = localISOString()
      // 5c. 重新构建 BM25 索引（带串行锁：并发 ingest 不会重叠 rebuild）
      const tokensAdded = tokenize(content).length
      await this._rebuildBM25(index, current, filename, content)
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
        refsUpdated,
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

  /**
   * 批量导入（v9.1.0 补充）
   * - 串行逐个调用 ingest，避免并发写冲突和 BM25 重建叠加
   * - 每完成一个文件调用 onProgress(progress)
   * - 支持 AbortSignal 取消：取消后中断后续文件，返回已处理结果
   * @param {Object} args
   * @param {string[]} args.filenames - 源文件名数组（相对工作区根目录）
   * @param {Function} [args.onProgress] - 进度回调({ current, total, filename, status, percent, result?, error?, code? })
   * @param {AbortSignal} [args.signal] - 取消信号
   * @returns {Promise<{status:'ok'|'partial'|'failed'|'cancelled', total, succeeded, failed, errors, durationMs, cancelled}>}
   */
async function ingestBatch({ filenames, onProgress, signal }) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    if (!Array.isArray(filenames) || filenames.length === 0) {
      throw new WorkspaceError('INVALID_PARAMS', 'filenames 必须是数组且至少包含一个文件', false)
    }

    const total = filenames.length
    let succeeded = 0
    let failed = 0
    const errors = []
    const startTime = Date.now()

    const reportProgress = (payload) => {
      if (typeof onProgress === 'function') {
        try {
          onProgress(payload)
        } catch (err) {
          console.warn('[WikiEngine.ingestBatch] onProgress 回调出错:', err.message)
        }
      }
    }

    for (let i = 0; i < total; i++) {
      const filename = filenames[i]
      const currentNum = i + 1

      if (signal?.aborted) {
        reportProgress({
          current: currentNum,
          total,
          filename,
          status: 'cancelled',
          percent: Math.round((i / total) * 100),
          error: '批量导入已取消'
        })
        break
      }

      reportProgress({
        current: i,
        total,
        filename,
        status: 'processing',
        percent: Math.round((i / total) * 100)
      })

      try {
        const result = await this.ingest({ filename })
        succeeded++
        reportProgress({
          current: currentNum,
          total,
          filename,
          status: 'ok',
          percent: Math.round((currentNum / total) * 100),
          result
        })
      } catch (err) {
        failed++
        const code = err instanceof WorkspaceError ? err.code : 'UNKNOWN'
        const errorMsg = err instanceof WorkspaceError ? err.message : (err.message || String(err))
        errors.push({ filename, error: errorMsg, code })
        reportProgress({
          current: currentNum,
          total,
          filename,
          status: 'error',
          percent: Math.round((currentNum / total) * 100),
          error: errorMsg,
          code
        })
      }
    }

    const cancelled = signal?.aborted === true
    let status
    if (cancelled) {
      status = 'cancelled'
    } else if (failed === 0) {
      status = 'ok'
    } else if (succeeded === 0) {
      status = 'failed'
    } else {
      status = 'partial'
    }

    return {
      status,
      total,
      succeeded,
      failed,
      errors,
      durationMs: Date.now() - startTime,
      cancelled
    }
  }

  /**
   * 将生成的报告内容直接 ingest 为 wiki 页面（不保留源 md 文件）
   * - 用于 write-handler 写入 docx/xlsx 时同步生成可搜索的 wiki 版本
   * - frontmatter 类型为 report，source 指向原报告文件
   * @param {Object} args
   * @param {string} args.filename - 原报告文件名（相对工作区），如 'reports/report.docx'
   * @param {string} args.content - markdown 格式正文
   * @param {string} [args.title] - 页面标题，默认使用 slug
   * @returns {Promise<{wikiPage: string}>}
   */
async function ingestReport({ filename, content, title }) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    const slug = _buildSlug(filename)
    const targetRel = `sources/${slug}.md`
    const sourcesDir = path.join(current.path, 'wiki', 'sources')
    const targetAbs = path.join(sourcesDir, `${slug}.md`)
    const nowIso = localISOString()
    const sections = this.computeSections(content)
    const fmObj = {
      type: 'report',
      title: title || slug,
      source: filename,
      tags: [],
      ingested_at: nowIso,
      updated_at: nowIso,
      quality: 'high',
      summary: null,
      keyPoints: [],
      confidence: 0.85,
      supersedes: [],
      entities: [],
      concepts: [],
      relatedPages: [],
      sections_version: 1,
      sections
    }
    const md = matter.stringify(content, fmObj)
    await fs.mkdir(sourcesDir, { recursive: true })
    await fs.writeFile(targetAbs, md.replace(/\r\n/g, '\n'), 'utf-8')

    // 更新 .workspace-index.json
    const index = await loadIndex(current.path)
    const crypto = require('crypto')
    const contentHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
    const nowMs = Date.now()
    index.files[filename] = {
      hash: `sha256:${contentHash}`,
      mtime: nowMs,
      size: Buffer.byteLength(content, 'utf-8'),
      wikiPage: targetRel,
      lastIngestAt: nowMs,
      quality: 'high',
      ingestVersion: 2
    }
    index.updatedAt = localISOString()
    await this._rebuildBM25(index, current, filename, content)
    await saveIndex(current.path, index)

    return { wikiPage: targetRel }
  }

module.exports = { ingest, ingestBatch, ingestReport, _rebuildBM25, _rebuildAnswerBM25, localISOString }
