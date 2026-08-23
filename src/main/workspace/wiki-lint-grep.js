// grep 全文正则检索 + lint 健康检查方法集（从 WikiEngine.js 拆分，行为不变）
// 通过 WikiEngine.prototype 挂载；经 this 访问 workspace/_rebuildAnswerBM25/getParamByName 等。
// compileGlob/escapeRegex 为 grep 专用顶层辅助，随迁至此。
// 依赖与主文件头部对齐；经 this 访问 workspace/_rebuildAnswerBM25/setParam 等。

const fs = require('fs').promises
const path = require('path')
const matter = require('gray-matter')
const { WorkspaceError } = require('./WorkspaceError')
const { loadIndex, saveIndex } = require('./index-store')
const { localISOString } = require('./wiki-ingest')

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
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  async function grep(pattern, options = {}) {
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
  async function lint() {
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

module.exports = { grep, lint }
