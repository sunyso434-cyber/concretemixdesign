// src/main/workspace/lastWorkspaceStore.js
// v9.0.0 补充21：工作区路径持久化
// 把"上次关闭时所在的工作区路径"保存到 userData/last-workspace.json，
// 启动时自动恢复；workspace.open 成功/close 时实时同步。

const fs = require('fs')
const path = require('path')

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
 * 读取上次保存的工作区路径。
 * @returns {string|null} 工作区绝对路径，若不存在/解析失败则返回 null
 */
function get() {
  if (!_filePath) {
    console.warn('[lastWorkspaceStore] get() 前未 init()，返回 null')
    return null
  }
  try {
    if (!fs.existsSync(_filePath)) return null
    const raw = fs.readFileSync(_filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.path === 'string' && parsed.path.length > 0) {
      return parsed.path
    }
    return null
  } catch (err) {
    console.warn('[lastWorkspaceStore] get() 失败，返回 null:', err.message)
    return null
  }
}

/**
 * 保存工作区路径到磁盘。失败仅打日志，不抛异常。
 * @param {string} p - 工作区绝对路径
 */
function set(p) {
  if (!_filePath) {
    console.warn('[lastWorkspaceStore] set() 前未 init()，忽略')
    return
  }
  if (!p || typeof p !== 'string') return
  try {
    // 原子写：先写 tmp 再 rename，避免中途崩溃损坏 JSON
    const tmp = _filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ path: p, savedAt: new Date().toISOString() }, null, 2), 'utf8')
    fs.renameSync(tmp, _filePath)
  } catch (err) {
    console.error('[lastWorkspaceStore] set() 失败:', err.message)
  }
}

/**
 * 清除持久化的工作区路径（用户主动关闭工作区时调用）。
 */
function clear() {
  if (!_filePath) return
  try {
    if (fs.existsSync(_filePath)) {
      fs.unlinkSync(_filePath)
    }
  } catch (err) {
    console.warn('[lastWorkspaceStore] clear() 失败:', err.message)
  }
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
  _getFilePath,
}