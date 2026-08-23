// 路径安全工具：把渲染进程 / LLM 工具提供的路径输入收口到指定根目录内
// 背景：skill 名、报告文件名、工作区相对路径等若直接 path.join，
// 传入 "..\.." 或绝对路径即可读写删工作区之外的任意文件（2026-08-22 安全审查高危项）。
// 参照 markdownHandler.js 的 realpath + 白名单做法，统一抽成可复用函数。

const path = require('path')

class PathGuardError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PathGuardError'
    this.code = 'E_PATH_ESCAPE'
  }
}

/**
 * 纯标识符校验（技能名、toolCallId 等最终会成为文件名的字符串）
 * 只允许：字母、数字、下划线、连字符、中文；禁止任何分隔符与点号。
 */
function assertSafeSegment(name, label = '名称') {
  if (typeof name !== 'string' || name.length === 0) {
    throw new PathGuardError(`${label}不能为空`)
  }
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,128}$/.test(name)) {
    throw new PathGuardError(`${label}含非法字符（仅允许中英文、数字、-、_，且不能包含路径分隔符）`)
  }
  return name
}

/**
 * 文件名校验（允许点号以保留扩展名，如 "报告.docx"，但禁止路径分隔符与 .. 逃逸）
 */
function assertSafeFileName(filename, label = '文件名') {
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new PathGuardError(`${label}不能为空`)
  }
  if (path.isAbsolute(filename) || /^[a-zA-Z]:/.test(filename)) {
    throw new PathGuardError(`${label}不能是绝对路径`)
  }
  if (/[\\/]/.test(filename)) {
    throw new PathGuardError(`${label}不能包含路径分隔符`)
  }
  if (filename === '.' || filename === '..' || filename.includes('..')) {
    throw new PathGuardError(`${label}不能包含 ..`)
  }
  return filename
}

/**
 * 工作区相对路径收口：允许子目录（如 "reports/xxx.md"），解析后必须落在 root 内。
 * 返回解析后的绝对路径；越界（绝对路径、.. 逃逸）抛 PathGuardError。
 */
function resolveInside(root, relPath, label = '路径') {
  if (typeof relPath !== 'string' || relPath.trim().length === 0) {
    throw new PathGuardError(`${label}不能为空`)
  }
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new PathGuardError(`${label}不能是绝对路径（仅允许工作区内相对路径）`)
  }
  const absRoot = path.resolve(root)
  const absTarget = path.resolve(absRoot, relPath)
  if (absTarget !== absRoot && !absTarget.startsWith(absRoot + path.sep)) {
    throw new PathGuardError(`${label}越出工作区范围: ${relPath}`)
  }
  return absTarget
}

/**
 * 判断绝对路径 target 是否位于 root 内（含 root 本身）。
 * 用于"写类工具仅允许工作区内"的场景（office 编辑/创建等）。
 */
function isPathInsideRoot(root, target) {
  if (typeof target !== 'string' || target.length === 0) return false
  const absRoot = path.resolve(root)
  const absTarget = path.resolve(target)
  return absTarget === absRoot || absTarget.startsWith(absRoot + path.sep)
}

module.exports = {
  PathGuardError,
  assertSafeSegment,
  assertSafeFileName,
  resolveInside,
  isPathInsideRoot
}
