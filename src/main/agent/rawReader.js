/**
 * 原始文件读取器（纯函数模块 + IO 封装）
 *
 * 职责：读工作区任意文本类文件原文，供 Agent 直接看原始内容（不经 wiki 摘要）。
 *
 * 限制：
 *   - 只支持文本类扩展名，二进制（PDF/Word/Excel）拒绝并返回提示
 *   - 排除系统目录（node_modules / .git / .tmp）
 *   - 路径校验：禁止 .. 越界逃出工作区
 *   - 单文件 300KB 截断，防撑爆 LLM 上下文
 */

const fs = require('fs').promises
const path = require('path')

const MAX_SIZE = 300 * 1024

const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.log',
  '.json', '.csv', '.tsv',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.html', '.htm', '.css', '.scss',
  '.yaml', '.yml', '.xml', '.ini', '.conf', '.toml',
  '.sh', '.bat', '.ps1', '.py', '.go', '.java', '.c', '.cpp', '.h'
])

const BINARY_EXTS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.exe', '.dll', '.so', '.bin',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav'
])

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.tmp', '.svn', '.hg',
  'wiki', 'reports', 'chat-history'
])

function isTextFile(filename) {
  const ext = path.extname(filename).toLowerCase()
  return TEXT_EXTS.has(ext)
}

function isBinaryFile(filename) {
  const ext = path.extname(filename).toLowerCase()
  return BINARY_EXTS.has(ext)
}

function isPathExcluded(relativePath) {
  const parts = relativePath.split('/')
  for (const p of parts) {
    if (EXCLUDED_DIRS.has(p)) return true
  }
  return false
}

function containsTraversal(relativePath) {
  const parts = relativePath.split('/')
  return parts.some(p => p === '..')
}

function isAbsoluteLike(p) {
  if (!p) return false
  return p.startsWith('/') ||
    p.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(p) ||
    p.startsWith('~')
}

function validateRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return { valid: false, reason: '路径不能为空' }
  }
  if (isAbsoluteLike(relativePath)) {
    return { valid: false, reason: '必须是工作区相对路径，不能是绝对路径' }
  }
  if (containsTraversal(relativePath)) {
    return { valid: false, reason: '路径不能包含 .. 越界' }
  }
  if (isPathExcluded(relativePath)) {
    return { valid: false, reason: '该目录已被排除（系统目录或内部目录）' }
  }
  return { valid: true }
}

async function readRaw(workspacePath, relativePath, options = {}) {
  const validation = validateRelativePath(relativePath)
  if (!validation.valid) {
    return {
      success: false,
      code: 'PATH_INVALID',
      message: validation.reason,
      hint: '请提供工作区内文本文件的相对路径，如 "临时备注.md" 或 "raw/md/规范.md"'
    }
  }

  const filename = path.basename(relativePath)
  if (isBinaryFile(filename)) {
    return {
      success: false,
      code: 'BINARY_REJECTED',
      message: `${filename} 是二进制文件，不能直接读取`,
      hint: '请先调用 workspace_ingest 把该文件导入 wiki，再用 workspace_readPage 读取'
    }
  }

  if (!isTextFile(filename)) {
    return {
      success: false,
      code: 'UNSUPPORTED_EXT',
      message: `${filename} 不是受支持的文本文件类型`,
      hint: '支持的扩展名：.md .txt .json .csv .js .log .yaml .xml 等'
    }
  }

  const absPath = path.posix.join(workspacePath, relativePath)
  let content
  try {
    content = await fs.readFile(absPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: `文件不存在：${relativePath}`,
        hint: '请检查路径是否正确，或用 workspace_listFiles 列出可用文件'
      }
    }
    return {
      success: false,
      code: 'READ_FAIL',
      message: `读取失败：${err.message}`,
      hint: '请检查文件权限或编码（需 UTF-8）'
    }
  }

  const bytes = Buffer.byteLength(content, 'utf-8')
  let truncated = false
  let finalContent = content
  if (bytes > MAX_SIZE) {
    const ratio = MAX_SIZE / bytes
    const cut = Math.floor(content.length * ratio)
    finalContent = content.slice(0, cut)
    truncated = true
  }

  return {
    success: true,
    path: relativePath,
    content: finalContent,
    size: bytes,
    truncated,
    truncatedAt: truncated ? MAX_SIZE : null,
    note: truncated
      ? `文件 ${bytes} 字节，已截断到 ${MAX_SIZE} 字节。如需看后续内容，请用 offset 参数分段读`
      : null
  }
}

module.exports = {
  readRaw,
  isTextFile,
  isBinaryFile,
  isPathExcluded,
  validateRelativePath,
  MAX_SIZE,
  TEXT_EXTS,
  BINARY_EXTS,
  EXCLUDED_DIRS
}
