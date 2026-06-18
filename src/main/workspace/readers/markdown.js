// markdown reader：读取 .md 文件
// - 用 gray-matter 解析 frontmatter（YAML between `---` markers），分离 frontmatter 与 body
// - 无 frontmatter 时，frontmatter = {}，hasFrontmatter = false，content = 整文件正文
//
// 所有失败抛 WorkspaceError（带 code + retryable）。
// size 限制：200 MB（> 200MB 触发 SIZE_EXCEEDED，retryable=false）
const fs = require('fs').promises
const matter = require('gray-matter')
const { WorkspaceError } = require('../WorkspaceError')

const MAX_SIZE = 200 * 1024 * 1024 // 200 MB

async function read(filePath, options = {}) {
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_SIZE) {
      throw new WorkspaceError('SIZE_EXCEEDED', `${filePath} > 200MB`, false)
    }

    const rawText = await fs.readFile(filePath, 'utf-8')

    let parsed
    try {
      parsed = matter(rawText)
    } catch (err) {
      throw new WorkspaceError(
        'PARSE_FAIL',
        `Markdown frontmatter 解析失败: ${err.message}`,
        false,
        err
      )
    }

    const frontmatter = (parsed.data && typeof parsed.data === 'object') ? parsed.data : {}
    const hasFrontmatter = Object.keys(frontmatter).length > 0

    return {
      content: parsed.content,
      metadata: {
        frontmatter,
        encoding: 'utf-8',
        hasFrontmatter
      }
    }
  } catch (err) {
    if (err instanceof WorkspaceError) throw err
    throw new WorkspaceError('READ_FAIL', `读取 ${filePath} 失败: ${err.message}`, true, err)
  }
}

module.exports = { read }