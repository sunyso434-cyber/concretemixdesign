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

class WikiEngine {
  constructor({ workspace }) {
    this.workspace = workspace
  }

  // P1 简化版：直接写，不原子性。P2 Task 2.1 升级。
  async ingest({ filename }) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

    const sourcePath = path.posix.join(current.path, filename)
    try {
      await fs.access(sourcePath)
    } catch {
      throw new WorkspaceError('FILE_NOT_FOUND', `${filename} 不存在`, false)
    }

    // 1. 读
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

    // 2. slug 化文件名（v1.5.1 原始设计：P1 简化版不处理中文 sha1 后缀；Task 2.1 升级时加）
    const slug = path.parse(filename).name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w一-龥-]/g, '')

    // 3. 写 wiki/sources/<slug>.md（P1 简化版，无 frontmatter / 原子性）
    const targetDir = path.join(current.path, 'wiki', 'sources')
    try {
      await fs.mkdir(targetDir, { recursive: true })
      const targetPath = path.join(targetDir, `${slug}.md`)
      const md = `# ${slug}\n\n${content}\n`
      await fs.writeFile(targetPath, md, 'utf-8')
    } catch (err) {
      throw new WorkspaceError('WRITE_FAIL', `写入 wiki/sources/${slug}.md 失败: ${err.message}`, true, err)
    }

    return {
      status: 'ok',
      pagesCreated: [`sources/${slug}.md`],
      pagesUpdated: [],
      refsUpdated: 0,
      durationMs: 0
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
}

module.exports = { WikiEngine }