// src/main/workspace/lastWorkspaceStore.js
// v9.0.0 补充21：工作区路径持久化
// 把"上次关闭时所在的工作区路径"保存到 userData/last-workspace.json，
// 启动时自动恢复；workspace.open 成功/close 时实时同步。
//
// R8 扩展：单 path → 最近 N 列表（{ recent: [{ path, savedAt }] }）。
//   - get() 仍返回最近一个 path（兼容现有调用方 workspace:getLastWorkspace / main.js 自动恢复）
//   - set(p) 插入最近列表最前，去重（重复 open 同路径置顶 + 刷新 savedAt）
//   - 最近 N=20 上限，超出截断最旧
//   - 旧格式 { path, savedAt } 读取时幂等升级为 { recent: [{ path, savedAt }] }
//   - clear() 清空最近列表（写空 recent，保留列表语义）
//   - listRecent() 新增：返回最近列表，供 RemoteWorkspaceApi.listRecent 使用

const fs = require('fs')
const path = require('path')

// 最近工作区保留条数
const MAX_RECENT = 20

let _filePath = null

/**
 * 初始化 store 的存储路径。必须在使用前调用一次。
 * @param {string} userDataDir - Electron app.getPath('userData') 返回值
 */
function init(userDataDir) {
  if (!userDataDir) {
    throw new Error('[lastWorkspaceStore] init 需要 userDataDir')
  }
  _filePath = path.join(userDataDir, 'last-workspace.json')
}

/**
 * 内部：读磁盘并把旧格式幂等归一化为最近列表。
 * - 新格式 { recent: [...] } → 直接返回（过滤掉非法条目）
 * - 旧格式 { path, savedAt } → 升级为单元素 recent
 * - 文件缺失 / JSON 损坏 / 无法解析 → 返回 []（不抛，兼容 get() 原失败返回 null 语义）
 * @returns {Array<{path: string, savedAt: string|null}>} 最近列表（recent[0] 为最近）
 */
function _readRecent() {
  if (!_filePath) return []
  try {
    if (!fs.existsSync(_filePath)) return []
    const raw = fs.readFileSync(_filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    if (Array.isArray(parsed.recent)) {
      return parsed.recent.filter(e => e && typeof e.path === 'string' && e.path.length > 0)
    }
    // 旧格式 { path, savedAt } → 幂等升级为单元素 recent
    if (typeof parsed.path === 'string' && parsed.path.length > 0) {
      return [{ path: parsed.path, savedAt: parsed.savedAt || null }]
    }
    return []
  } catch (err) {
    console.warn('[lastWorkspaceStore] 读取失败，返回空列表:', err.message)
    return []
  }
}

/**
 * 读取最近打开的工作区路径。
 * @returns {string|null} 最近一个工作区绝对路径，若不存在/解析失败则返回 null
 */
function get() {
  if (!_filePath) {
    console.warn('[lastWorkspaceStore] get() 前未 init()，返回 null')
    return null
  }
  const recent = _readRecent()
  return recent.length > 0 ? recent[0].path : null
}

/**
 * 把工作区路径保存到最近列表（放最前，去重）。
 * 失败仅打日志，不抛异常。
 * @param {string} p - 工作区绝对路径
 */
function set(p) {
  if (!_filePath) {
    console.warn('[lastWorkspaceStore] set() 前未 init()，忽略')
    return
  }
  if (!p || typeof p !== 'string') return
  try {
    const recent = _readRecent()
    // 去重：同路径从列表中移除，新加的放最前
    const filtered = recent.filter(e => e.path !== p)
    const entry = { path: p, savedAt: new Date().toISOString() }
    const next = [entry, ...filtered].slice(0, MAX_RECENT)
    // 原子写：先写 tmp 再 rename，避免中途崩溃损坏 JSON
    const tmp = _filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ recent: next }, null, 2), 'utf8')
    fs.renameSync(tmp, _filePath)
  } catch (err) {
    console.error('[lastWorkspaceStore] set() 失败:', err.message)
  }
}

/**
 * 清空最近列表（用户主动关闭工作区时调用，下次启动显示欢迎页）。
 * 写空 recent 而非删文件，保留列表语义；get() 返回 null。
 */
function clear() {
  if (!_filePath) return
  try {
    const tmp = _filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ recent: [] }, null, 2), 'utf8')
    fs.renameSync(tmp, _filePath)
  } catch (err) {
    console.warn('[lastWorkspaceStore] clear() 失败:', err.message)
  }
}

/**
 * R8 新增：返回最近列表（含 savedAt，新在前）。
 * @returns {Array<{path: string, savedAt: string|null}>}
 */
function listRecent() {
  return _readRecent()
}

/**
 * 内部用：获取完整文件路径（仅供测试/调试使用）。
 */
function _getFilePath() {
  return _filePath
}

module.exports = {
  init,
  get,
  set,
  clear,
  listRecent,
  _getFilePath,
}