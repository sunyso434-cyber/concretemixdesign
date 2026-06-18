// src/renderer/utils/workspaceFile.js
//
// P1 补全 - 工作区文件工具函数（纯函数，无依赖）
//
// ⚠️ 关键：toSlug 必须与 src/main/workspace/WikiEngine.js ingest 保持完全一致！
// 否则 Popover 显示「✅ 已导入」但实际 wiki 页面 slug 不匹配。
// 修改 WikiEngine slug 算法时必须同步修改本文件。
//
// Task 2.1 (v1.5.3 P2a 升级) slug 算法（与 WikiEngine.ingest 一致）：
//   1. 去掉最后一个扩展名
//   2. .toLowerCase()                  - 小写
//   3. .replace(/\s+/g, '-')           - 空格转 dash
//   4. .replace(/[^\w一-龥-]/g, '')    - 保留 word/CJK/dash，剥离其他
//   5. 含中文（/[一-龥]/）→ 追加 FNV-1a(filename) 前 6 位 hex
//      避免同义/相似中文文件名冲突（spec §4.10）
//
// 跨平台一致性（前后端都用 FNV-1a 32-bit）：
// - 原因：SHA-1 浏览器侧 Web Crypto SubtleCrypto.digest 是异步 API，
//   Popover 同步调用 toSlug 不能改 async；FNV-1a 是同步纯 JS 哈希，
//   32-bit 输出足够去重（碰撞率 1/2^24 ≈ 1.7e-8）
// - 后端（Node）：Math.imul + UTF-8 byte 序列
// - 前端（浏览器）：Math.imul + UTF-8 byte 序列
// - 标准测试向量：FNV-1a 32-bit('foo') = 0xa9f37ed7
// - 验证：fnv1a32('混凝土说明.txt') 前后端必须完全一致

/**
 * FNV-1a 32-bit 哈希（UTF-8 字节序列输入）
 * @param {string} str
 * @returns {number} 无符号 32-bit 整数
 */
function fnv1a32(str) {
  // UTF-8 编码
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      i++
      const next = str.charCodeAt(i)
      code = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff))
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  let h = 0x811c9dc5
  for (const b of bytes) {
    h = h ^ b
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 把文件名转成 wiki slug（与 WikiEngine.ingest 行为完全一致）
 *
 * 不变量：toSlug(sourceFilename) === toSlug(对应 wiki 文件名)
 * - 对原始 source filename（'混凝土说明.txt'）→ 加 hash 后缀
 * - 对已存在的 wiki 文件名（'混凝土说明-33d690.md'）→ 检测到 hex 后缀，**不**再加 hash
 *
 * @param {string} filename - 完整文件名（'混凝土说明.txt' 或 '混凝土说明-33d690.md'）
 * @returns {string} slug
 */
export function toSlug(filename) {
  if (typeof filename !== 'string') return ''
  // 用 lastIndexOf 模拟 path.parse(filename).name 行为（去掉最后一个扩展名）
  const lastDot = filename.lastIndexOf('.')
  const name = lastDot > 0 ? filename.slice(0, lastDot) : (lastDot === 0 ? '' : filename)
  // 1. 含中文 → 追加 FNV-1a(filename) 前 6 位 hex
  // 2. 但如果 slugBase 已经以 6 位 hex 结尾（说明是已生成的 wiki 文件名），跳过
  const slugBase = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-龥-]/g, '')
  const HEX_SUFFIX = /-[a-f0-9]{6}$/
  if (/[一-龥]/.test(slugBase) && !HEX_SUFFIX.test(slugBase)) {
    return `${slugBase}-${fnv1a32(filename).toString(16).padStart(8, '0').substring(0, 6)}`
  }
  return slugBase
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
