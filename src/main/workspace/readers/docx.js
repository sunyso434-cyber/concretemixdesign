// docx reader：读取 .docx 文件
// - 用 mammoth.convertToMarkdown({ buffer }) 提取 markdown
// - 损坏 / 解析异常 → PARSE_FAIL（retryable=false，损坏文件重试也救不回来）
// - 文件读取失败 → READ_FAIL（retryable=true，比如临时权限/EIO）
// - > 200MB → SIZE_EXCEEDED（retryable=false）
//
// 所有失败抛 WorkspaceError（带 code + retryable）。
const fs = require('fs').promises
const mammoth = require('mammoth')
const { WorkspaceError } = require('../WorkspaceError')

const MAX_SIZE = 200 * 1024 * 1024 // 200 MB

async function read(filePath, options = {}) {
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_SIZE) {
      throw new WorkspaceError('SIZE_EXCEEDED', `${filePath} > 200MB`, false)
    }

    const buffer = await fs.readFile(filePath)

    let result
    try {
      result = await mammoth.convertToMarkdown({ buffer })
    } catch (err) {
      // 损坏 / 不支持的 docx 结构 / zip 解压失败都走 PARSE_FAIL
      throw new WorkspaceError('PARSE_FAIL', `DOCX 解析失败: ${err.message}`, false, err)
    }

    return {
      content: result.value || '',
      metadata: {
        // mammoth 的 messages 数组：包含图片 / 复杂表格等不支持元素的警告
        warnings: Array.isArray(result.messages) ? result.messages.length : 0
      }
    }
  } catch (err) {
    if (err instanceof WorkspaceError) throw err
    throw new WorkspaceError('READ_FAIL', `读取 ${filePath} 失败: ${err.message}`, true, err)
  }
}

module.exports = { read }