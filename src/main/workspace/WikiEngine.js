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

class WikiEngine {
  constructor({ workspace }) {
    this.workspace = workspace
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

      // 1d. 生成 sources/<slug>.md（含 frontmatter：必填 4 + 选填 4 占位）
      const sourcesDir = path.join(tmpDir, 'sources')
      await fs.mkdir(sourcesDir, { recursive: true })
      const targetRel = `sources/${slug}.md`
      const targetAbs = path.join(tmpDir, targetRel)
      const nowIso = new Date().toISOString()
      const md = `---
title: "${slug}"
source: "${filename}"
ingested_at: "${nowIso}"
updated_at: "${nowIso}"
quality: "high"
tags: []
entities: []
concepts: []
---

# ${slug}

${content}
`
      await fs.writeFile(targetAbs, md, 'utf-8')

      // 1e. P2a 暂不更新 index.md / log.md（Task 2.2 引入 schema 后做）
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
        durationMs: Date.now() - startTime
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
  async readPage(wikiPath) {
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
    return { content, frontmatter, mtime: stat.mtimeMs, size: stat.size }
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
    const REQUIRED_FM = ['title', 'source', 'ingested_at', 'updated_at', 'quality']
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

    return { status: 'ok', answerPath: answerRel }
  }
}

module.exports = { WikiEngine }