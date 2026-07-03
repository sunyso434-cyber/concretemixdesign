/**
 * 文件整理器（纯函数模块）
 *
 * 职责：把文件按扩展名归类到 raw/{类型}/ 子目录。
 * 两个入口：
 *   - organizeFile：单个文件归位（根目录手动触发用）
 *   - classifyByExt：根据扩展名返回目标子目录名（共用）
 *
 * 设计原则：
 *   - 纯函数，不直接碰 fs，所有 IO 由调用方（WorkspaceManager / workspaceTools）完成
 *   - 同名冲突由调用方处理，本模块只算出"目标相对路径"
 *   - 子目录里已分类文件不挪动，但若放错类型（如 raw/pdf/a.txt）→ 报告 misclassified
 */

const path = require('path')

const TYPE_RULES = [
  { type: 'pdf', exts: ['.pdf'] },
  { type: 'docx', exts: ['.docx'] },
  { type: 'xlsx', exts: ['.xlsx', '.xls', '.csv'] },
  { type: 'md', exts: ['.md', '.markdown'] },
  { type: 'txt', exts: ['.txt', '.log'] },
  { type: 'images', exts: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] },
  { type: 'json', exts: ['.json'] },
  { type: 'js', exts: ['.js', '.mjs', '.cjs'] }
]

const UNKNOWN_TYPE = 'others'

function classifyByExt(filename) {
  const ext = path.extname(filename).toLowerCase()
  for (const rule of TYPE_RULES) {
    if (rule.exts.includes(ext)) return rule.type
  }
  return UNKNOWN_TYPE
}

function getAllTypes() {
  return TYPE_RULES.map(r => r.type).concat([UNKNOWN_TYPE])
}

function getExpectedSubdir(filename) {
  return classifyByExt(filename)
}

function isMisclassified(relativePath) {
  const parts = relativePath.split('/')
  if (parts.length < 2) return false
  const subdir = parts[0]
  const filename = parts[parts.length - 1]
  const expected = classifyByExt(filename)
  return subdir !== expected
}

function buildTargetRelPath(filename, existingCount = 0) {
  const subdir = classifyByExt(filename)
  const base = path.basename(filename)
  if (existingCount === 0) return `${subdir}/${base}`
  const ext = path.extname(filename)
  const stem = path.basename(filename, ext)
  return `${subdir}/${stem}_${existingCount}${ext}`
}

module.exports = {
  classifyByExt,
  getAllTypes,
  getExpectedSubdir,
  isMisclassified,
  buildTargetRelPath,
  TYPE_RULES,
  UNKNOWN_TYPE
}
