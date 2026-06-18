const { ipcMain, dialog } = require('electron')
const { wrapWorkspaceCall } = require('../workspace/error-bridge')
const { WorkspaceError } = require('../workspace/WorkspaceError')

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
    const result = await refs.workspaceManager.open(path)
    // v2026-06-19 修订：open 成功后立即启动 watch（只在当前工作区生效）
    if (refs.wikiEngine) {
      refs.workspaceManager.watch(refs.wikiEngine)
    }
    return result
  }))

  ipcMain.handle('workspace:close', wrapWorkspaceCall(async () => {
    refs.workspaceManager.unwatch()
    refs.workspaceManager.close()
    return { ok: true }
  }))

  ipcMain.handle('workspace:current', wrapWorkspaceCall(async () => {
    return refs.workspaceManager.current()
  }))

  ipcMain.handle('workspace:listFiles', wrapWorkspaceCall(async (event, { subdir }) => {
    return { files: await refs.workspaceManager.listFiles(subdir) }
  }))

  // Task 1.10: workspace:ingest - 调 WikiEngine.ingest 读源文件 → 写 wiki/sources/<slug>.md
  ipcMain.handle('workspace:ingest', wrapWorkspaceCall(async (event, { filename }) => {
    if (!refs.wikiEngine) {
      throw new WorkspaceError('NOT_OPEN', 'WikiEngine 未初始化（请重启应用）', false)
    }
    return await refs.wikiEngine.ingest({ filename })
  }))

  // Task 1.12: workspace:readPage - 读 wiki 页面（解析 frontmatter）
  ipcMain.handle('workspace:readPage', wrapWorkspaceCall(async (event, { wikiPath }) => {
    if (!refs.wikiEngine) {
      throw new WorkspaceError('NOT_OPEN', 'WikiEngine 未初始化（请重启应用）', false)
    }
    return await refs.wikiEngine.readPage(wikiPath)
  }))

  // Task 2.8: workspace:lint - 扫 wiki 健康检查（spec §4.2）
  // 返回 LintReport：{ missingFrontmatter, orphans, missingCrossRefs, staleSummaries, contradictions, scannedAt }
  ipcMain.handle('workspace:lint', wrapWorkspaceCall(async () => {
    if (!refs.wikiEngine) {
      throw new WorkspaceError('NOT_OPEN', 'WikiEngine 未初始化（请重启应用）', false)
    }
    return await refs.wikiEngine.lint()
  }))

  // Task P1.13: workspace:pickFolder - 弹出原生文件夹选择器并打开工作区
  ipcMain.handle('workspace:pickFolder', wrapWorkspaceCall(async () => {
    const result = await dialog.showOpenDialog({
      title: '选择工作区文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null }
    }
    const selectedPath = result.filePaths[0]
    await refs.workspaceManager.open(selectedPath)
    return { canceled: false, path: refs.workspaceManager.current().path }
  }))

  // 后续 task 加：workspace:search / workspace:writeFile / workspace:lint / workspace:searchGraph
}

module.exports = { register }