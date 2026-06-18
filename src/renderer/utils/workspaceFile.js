// src/renderer/utils/workspaceFile.js
//
// P1 补全 - 工作区文件工具函数（纯函数，无依赖）
//
// ⚠️ 关键：toSlug 必须与 src/main/workspace/WikiEngine.js:53-57 保持完全一致！
// 否则 Popover 显示「✅ 已导入」但实际 wiki 页面 slug 不匹配。
// 修改 WikiEngine slug 算法时必须同步修改本文件。
//
// 当前 P1 简化版 slug 算法（与 WikiEngine.ingest 一致）：
//   1. path.parse(filename).name  - 去扩展名
//   2. .toLowerCase()              - 小写
//   3. .replace(/\s+/g, '-')       - 空格转 dash
//   4. .replace(/[^\w一-龥-]/g, '') - 保留 word/CJK/dash，剥离其他
// 已知限制：中文/重复文件名不做 sha1 后缀去重（P2 Task 2.1 升级处理）

/**
 * 把文件名转成 wiki slug（与 WikiEngine.ingest 行为完全一致）
 * @param {string} filename - 完整文件名（如 'spec.md'、'我的文档.pdf'）
 * @returns {string} slug
 */
export function toSlug(filename) {
  if (typeof filename !== 'string') return ''
  // 用 lastIndexOf 模拟 path.parse(filename).name 行为（去掉最后一个扩展名）
  const lastDot = filename.lastIndexOf('.')
  const name = lastDot > 0 ? filename.slice(0, lastDot) : (lastDot === 0 ? '' : filename)
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-龥-]/g, '')
}

/**
 * 支持 ingest 的文件扩展名（5 种）
 */
export const SUPPORTED_EXTS = ['.txt', '.md', '.pdf', '.docx', '.xlsx']

/**
 * 判断文件扩展名是否支持 ingest
 * @param {string} filename
 * @returns {boolean}
 */
export function isSupportedExt(filename) {
  if (typeof filename !== 'string') return false
  const lower = filename.toLowerCase()
  return SUPPORTED_EXTS.some(ext => lower.endsWith(ext))
}

/**
 * 从 listFiles('wiki/sources') 的结果中提取已导入的 slug 集合
 * @param {Array<{name?: string, path?: string}>} listResult
 * @returns {Set<string>} slug 集合（去掉 .md 后缀）
 */
export function getImportedSlugs(listResult) {
  const slugs = new Set()
  if (!Array.isArray(listResult)) return slugs
  for (const item of listResult) {
    if (!item || typeof item.name !== 'string') continue
    if (!item.name.toLowerCase().endsWith('.md')) continue
    // 复用 toSlug 处理（避免算法分叉）
    slugs.add(toSlug(item.name))
  }
  return slugs
}
