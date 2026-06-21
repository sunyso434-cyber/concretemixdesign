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

  // v2026-06-19 hotfix (v4.9.3)：openAndWatch 抽出复用
  // 老板报告"v4.9.2 拖入文件仍不自动 ingest" — log 显示 workspace IPC
  // 注册了但 watch 从未启动。原因：pickFolder handler 直接调
  // workspaceManager.open()，**绕过了 workspace:open IPC**，所以
  // workspace:open 里的 watch 启动逻辑（line 23-25）从未执行。
  // 修复：抽 openAndWatch 公共方法，open + pickFolder 都调它
  async function openAndWatch(selectedPath) {
    await refs.workspaceManager.open(selectedPath)
    if (refs.wikiEngine) {
      refs.workspaceManager.watch(refs.wikiEngine)
    }
    return refs.workspaceManager.current().path
  }

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
    // v2026-06-19 hotfix (v4.9.3)：用 openAndWatch（不绕过 watch 启动）
    const openedPath = await openAndWatch(selectedPath)
    return { canceled: false, path: openedPath }
  }))

  // Task 2.15: workspace:migrateSession - 迁移会话到新工作区
  ipcMain.handle('workspace:migrateSession', wrapWorkspaceCall(async (event, { sessionId, from, to }) => {
    if (!refs.chatHistorySync) {
      throw new WorkspaceError('CHAT_HISTORY_CROSS_WORKSPACE', 'ChatHistorySync 未初始化（请重启应用）', false)
    }
    return await refs.chatHistorySync.migrateSession(sessionId, from, to)
  }))

  // Task 2.15: workspace:exportSession - 手动导出指定 session
  ipcMain.handle('workspace:exportSession', wrapWorkspaceCall(async (event, { sessionId, workspacePath }) => {
    if (!refs.chatHistorySync) {
      throw new WorkspaceError('NOT_OPEN', 'ChatHistorySync 未初始化（请重启应用）', false)
    }
    return await refs.chatHistorySync.exportSession(sessionId, workspacePath)
  }))

  // Task 3.2: workspace:writeFile - 写 docx/xlsx/md 到 reports/（spec §4.5）
  ipcMain.handle('workspace:writeFile', wrapWorkspaceCall(async (event, { type, filename, payload }) => {
    const { writeFile } = require('../workspace/write-handler')
    return await writeFile({
      workspaceManager: refs.workspaceManager,
      type,
      filename,
      payload
    })
  }))

  // Task 5.4: workspace:searchGraph - BM25 查询知识图谱（spec §4.14）
  // v1.5.3 关键：kgExtractor 走 workspaceRefs（不是闭包变量）
  ipcMain.handle('workspace:searchGraph', wrapWorkspaceCall(async (event, { query, topK }) => {
    if (!refs.kgExtractor) {
      throw new WorkspaceError('NOT_OPEN', '知识图谱未启用（P5 阶段才激活）', false)
    }
    // 走当前工作区路径
    const current = refs.workspaceManager.current()
    if (!current || !current.path) {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    const results = await refs.kgExtractor.searchGraph(query, topK || 10, current.path)
    return { results }
  }))

  // 后续 task 加：workspace:search / workspace:searchGraph
}

module.exports = { register }