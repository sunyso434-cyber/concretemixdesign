// md 阅读器 IPC：md:read / md:write / md:watch / md:unwatch
// - 安全边界：白名单（当前 workspace 根 + skill 用户目录）+ realpath 解析（解决大小写/symlink 绕过）
// - 编辑写回必须原子写（tmp + rename），防崩溃损坏
const fs = require('fs').promises
const path = require('path')
const { ipcMain } = require('electron')
const matter = require('gray-matter')

const MAX_SIZE = 200 * 1024 * 1024 // 200 MB（与 readers/markdown.js 一致）
const EDIT_DISABLE_BYTES = 1 * 1024 * 1024 // 编辑禁用阈值 1MB

function getSkillUserDir() {
  try {
    const handler = require('./agentHandler')
    const reg = handler.getSkillRegistry && handler.getSkillRegistry()
    return (reg && reg.getUserDir && reg.getUserDir()) || null
  } catch {
    return null
  }
}

async function isAllowedPath(filePath, { workspaceRoot, skillUserDir }) {
  if (typeof filePath !== 'string' || !filePath) {
    return { ok: false, reason: '路径不能为空' }
  }
  if (!filePath.toLowerCase().endsWith('.md')) {
    return { ok: false, reason: '仅支持 .md 文件' }
  }
  let real
  try {
    real = await fs.realpath(filePath)
  } catch {
    return { ok: false, reason: '文件不存在' }
  }
  const roots = [workspaceRoot, skillUserDir].filter(Boolean)
  for (const root of roots) {
    const rel = path.relative(root, real)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return { ok: true, realPath: real }
    }
  }
  return { ok: false, reason: '路径不在允许目录内' }
}

async function readMd(filePath, roots) {
  const check = await isAllowedPath(filePath, roots)
  if (!check.ok) throw new Error(check.reason)
  const stat = await fs.stat(check.realPath)
  if (stat.size > MAX_SIZE) throw new Error('文件超过 200MB 上限')
  const rawText = await fs.readFile(check.realPath, 'utf-8')
  let parsed
  try {
    parsed = matter(rawText)
  } catch (err) {
    throw new Error(`frontmatter 解析失败: ${err.message}`)
  }
  return {
    content: rawText, // 完整原文（含 frontmatter），编辑/写回用
    body: parsed.content, // 去掉 frontmatter 的正文，预览用
    metadata: {
      frontmatter: parsed.data && typeof parsed.data === 'object' ? parsed.data : {},
      hasFrontmatter: Object.keys(parsed.data || {}).length > 0
    },
    mtimeMs: stat.mtimeMs,
    size: stat.size
  }
}

async function atomicWrite(targetPath, content) {
  const tmpPath = `${targetPath}.md-reader.tmp`
  try {
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, targetPath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

// 写回：守卫（非字符串 / 超 200MB）→ 白名单校验 → 原子写 → 重解析 body
async function writeMd(filePath, content, roots) {
  if (typeof content !== 'string') return { error: '内容必须为字符串' }
  if (Buffer.byteLength(content, 'utf-8') > MAX_SIZE) return { error: '内容超过 200MB 上限' }
  const check = await isAllowedPath(filePath, roots)
  if (!check.ok) return { error: check.reason }
  await atomicWrite(check.realPath, content)
  const stat = await fs.stat(check.realPath)
  // 写回后重新解析 body（预览态渲染去掉 frontmatter 的正文；frontmatter 解析失败则用全文）
  let body = content
  try { body = matter(content).content } catch { /* 保留全文 */ }
  return { ok: true, mtimeMs: stat.mtimeMs, size: stat.size, body }
}

function wrap(handler) {
  return async (event, payload) => {
    try {
      return await handler(event, payload)
    } catch (err) {
      return { error: err.message || String(err) }
    }
  }
}

function register(refs) {
  // refs.workspaceRoot：由 main.js 注入的 getter 或可变引用（workspace 切换后更新）
  const getRoots = () => ({
    workspaceRoot: typeof refs.getWorkspaceRoot === 'function' ? refs.getWorkspaceRoot() : (refs.workspaceRoot || null),
    skillUserDir: getSkillUserDir()
  })

  ipcMain.handle('md:read', wrap(async (event, { filePath }) => {
    return await readMd(filePath, getRoots())
  }))

  ipcMain.handle('md:write', wrap(async (event, { filePath, content }) => {
    return await writeMd(filePath, content, getRoots())
  }))

  ipcMain.handle('md:watch', wrap(async (event, { filePath }) => {
    const check = await isAllowedPath(filePath, getRoots())
    if (!check.ok) return { error: check.reason }
    const { mdWatcher } = require('../workspace/mdWatcher')
    mdWatcher.setSender(event.sender) // 事件推送到调用方窗口（当前单窗口应用够用）
    mdWatcher.watch(check.realPath)
    return { ok: true }
  }))

  ipcMain.handle('md:unwatch', wrap(async (event, { filePath }) => {
    const { mdWatcher } = require('../workspace/mdWatcher')
    let key = filePath
    try { key = await fs.realpath(filePath) } catch { /* 文件已删，回退原路径 */ }
    mdWatcher.unwatch(key)
    return { ok: true }
  }))
}

module.exports = { register, isAllowedPath, readMd, writeMd, atomicWrite, MAX_SIZE, EDIT_DISABLE_BYTES }
