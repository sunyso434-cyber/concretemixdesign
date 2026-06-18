const { ipcMain } = require('electron')
const { wrapWorkspaceCall } = require('../workspace/error-bridge')

/**
 * 注册 workspace IPC handlers（v1.5.3 多实例 + 命名统一）
 *
 * v1.5.3 关键：使用 mutable 引用对象 refs（不直接捕获单实例）。
 * 这样后续 task（如 P1.10 创建 wikiEngine、P5 创建 kgExtractor）只需修改 refs.inner 引用，
 * 无需重新 register IPC handlers —— 所有 handler 在调用时读 refs 的当前值。
 *
 * @param {Object} refs - mutable 引用对象
 * @param {Object|null} refs.workspaceManager - Task 1.8 创建的 WorkspaceManager
 * @param {Object|null} [refs.wikiEngine] - P1.10 注入
 * @param {Object|null} [refs.kgExtractor] - P5 注入
 */
function register(refs) {
  const { workspaceManager, wikiEngine = null, kgExtractor = null } = refs

  ipcMain.handle('workspace:open', wrapWorkspaceCall(async (event, { path }) => {
    return await refs.workspaceManager.open(path)
  }))

  ipcMain.handle('workspace:close', wrapWorkspaceCall(async () => {
    refs.workspaceManager.close()
    return { ok: true }
  }))

  ipcMain.handle('workspace:current', wrapWorkspaceCall(async () => {
    return refs.workspaceManager.current()
  }))

  ipcMain.handle('workspace:listFiles', wrapWorkspaceCall(async (event, { subdir }) => {
    return { files: await refs.workspaceManager.listFiles(subdir) }
  }))

  // 后续 task 加：workspace:ingest / workspace:readPage / workspace:search
  //                  / workspace:writeFile / workspace:lint / workspace:searchGraph
  // 这些 handler 会读 refs.wikiEngine / refs.kgExtractor
}

module.exports = { register }