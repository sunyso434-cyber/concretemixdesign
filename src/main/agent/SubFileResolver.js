/**
 * 加载 soft skill 的 Layer 3 子文件（reference.md / examples.md 等）
 *
 * 路径约定：
 *   baseDir/
 *     └── <skillName>/
 *         ├── reference.md
 *         ├── examples.md
 *         └── pitfalls.md
 *
 * 主文件 body 用 markdown 链接 [xxx.md](xxx.md) 引用子文件
 */

const fs = require('fs')
const path = require('path')

class SubFileResolver {
  /**
   * 从 body 中提取 markdown 链接形式的子文件引用
   * @param {string} body - skill 主文件 body
   * @returns {string[]} 子文件名（去重，例：['reference.md', 'examples.md']）
   */
  parseSubFileRefs(body) {
    if (!body || typeof body !== 'string') return []
    const refs = []
    const regex = /\[([^\]]+\.md)\]\([^)]+\)/g
    let match
    while ((match = regex.exec(body)) !== null) {
      if (!refs.includes(match[1])) {
        refs.push(match[1])
      }
    }
    return refs
  }

  /**
   * 加载指定子文件
   * @param {string} skillName - skill 名（同时是子目录名）
   * @param {string} subFileName - 子文件名，如 'reference.md'
   * @param {string} baseDir - 用户 skills 根目录
   * @returns {Promise<{success: bool, content?: string, error?: string}>}
   */
  async loadSubFile(skillName, subFileName, baseDir) {
    if (!skillName || !subFileName || !baseDir) {
      return { success: false, error: '缺少必要参数' }
    }

    // 安全检查：拒绝 ../ 等路径穿越
    if (subFileName.includes('..') || subFileName.includes('/') || subFileName.includes('\\')) {
      return { success: false, error: '非法文件名' }
    }

    const filePath = path.join(baseDir, skillName, subFileName)
    if (!fs.existsSync(filePath)) {
      // 子目录缺失也会落在这里（路径不存在 = false）
      return { success: false, error: `sub-file not found: ${filePath}` }
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return { success: true, content }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = SubFileResolver
