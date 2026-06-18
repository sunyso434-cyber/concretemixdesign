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
const { loadIndex } = require('./index-store')
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
  // - 中文文件名加 sha1(filename) 前 6 位短后缀（spec §4.10）
  // - IngestResult.bm25TokensAdded 占位 0（Task 2.5 接 BM25 后填实际值）
  async ingest({ filename }) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

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
      // 1f. P2a 暂不更新 .workspace-index.json（Task 2.3 引入）

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

      return {
        status: 'ok',
        pagesCreated: [targetRel],
        pagesUpdated: [],
        refsUpdated: 0,
        // v1.5.3 修订（P2a）：先加占位 0，Task 2.5 接 BM25 后填实际值
        bm25TokensAdded: 0,
        durationMs: 0
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

  // Task 1.12: readPage - 读 wiki 页面（解析 frontmatter）
  async readPage(wikiPath) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    if (wikiPath.includes('..')) {
      throw new WorkspaceError('PATH_INVALID', '路径不合法', false)
    }
    const absPath = path.posix.join(current.path, 'wiki', wikiPath)
    let raw
    try {
      raw = await fs.readFile(absPath, 'utf-8')
    } catch (err) {
      throw new WorkspaceError('PAGE_NOT_FOUND', `${wikiPath} 不存在`, false, err)
    }
    const matter = require('gray-matter')
    const { data: frontmatter, content } = matter(raw)
    const stat = await fs.stat(absPath)
    return { content, frontmatter, mtime: stat.mtimeMs, size: stat.size }
  }

  // Task 2.6: search - BM25 全文搜索 + snippet 生成（spec §4.5/§4.7）
  // - 返回 SearchHit[]：{ path, title, snippet, score, sourceType: 'wiki' }
  // - snippet 规则：找第一个匹配位置，前后各取 50/150 字符，前后加 … 省略号
  // - 空 query → []，NOT_OPEN → WorkspaceError(NOT_OPEN)
  async search(query, topK = 5) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

    if (!query || !query.trim()) return []

    const index = await loadIndex(current.path)
    let bm25Index = index.bm25Index
    // 桥接 fallback：若 .workspace-index.json 还没建立（Task 2.5 ingest→index 桥接未完成），
    // 动态扫 wiki/sources/*.md 重建临时 BM25 索引。Task 2.5 完成后此分支可删。
    if (!bm25Index || (bm25Index.totalDocs || 0) === 0) {
      const sourcesDir = path.posix.join(current.path, 'wiki', 'sources')
      let entries = []
      try {
        entries = await fs.readdir(sourcesDir)
      } catch { entries = [] }
      const docs = []
      for (const name of entries) {
        if (!name.endsWith('.md')) continue
        const relPath = `sources/${name}`
        const abs = path.posix.join(current.path, 'wiki', relPath)
        try {
          const raw = await fs.readFile(abs, 'utf-8')
          const m = raw.match(/^---\n[\s\S]+?\n---\n([\s\S]*)$/)
          docs.push({ path: relPath, content: m ? m[1] : raw })
        } catch { /* skip */ }
      }
      bm25Index = buildBM25(docs)
    }
    const hits = queryBM25(bm25Index, query, topK)

    // 生成 snippet
    const queryTokens = new Set(tokenize(query))

    const enriched = []
    for (const hit of hits) {
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

      enriched.push({ ...hit, title: hit.path, snippet, sourceType: 'wiki' })
    }

    return enriched
  }
}

module.exports = { WikiEngine }