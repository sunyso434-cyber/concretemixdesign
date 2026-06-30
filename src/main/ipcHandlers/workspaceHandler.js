const { ipcMain, dialog, shell } = require('electron')
const { AbortController } = require('events')
const fs = require('fs')
const path = require('path')
const { wrapWorkspaceCall } = require('../workspace/error-bridge')
const { WorkspaceError } = require('../workspace/WorkspaceError')
const lastWorkspaceStore = require('../workspace/lastWorkspaceStore')

// v9.1.0 补充：批量导入任务管理（batchId -> { controller, startTime, total }）
const batchRuns = new Map()
function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

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

  // v9.0.0 补充21：渲染端读取上次工作区路径（启动时显示"上次打开的是 XX"提示用）
  ipcMain.handle('workspace:getLastWorkspace', async () => {
    try {
      return { success: true, path: lastWorkspaceStore.get() }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // v9.0.0 补充21：渲染端主动清除"上次工作区"记忆
  ipcMain.handle('workspace:clearLastWorkspace', async () => {
    try {
      lastWorkspaceStore.clear()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('workspace:listFiles', wrapWorkspaceCall(async (event, { subdir, workspacePath }) => {
    // 指定 workspacePath 时，直接用 fs 读该路径（用于侧栏按工作区显示文件树）
    if (workspacePath) {
      try {
        const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true })
        const files = entries
          .filter(e => !e.name.startsWith('.')) // 过滤隐藏文件
          .map(e => ({
            name: e.name,
            path: path.join(workspacePath, e.name),
            isDir: e.isDirectory()
          }))
        return { files }
      } catch (err) {
        throw new WorkspaceError('NOT_OPEN', `读取工作区文件失败: ${err.message}`, false)
      }
    }
    return { files: await refs.workspaceManager.listFiles(subdir) }
  }))

  // 在系统资源管理器中打开指定工作区文件夹
  ipcMain.handle('workspace:openInExplorer', async (_event, { workspacePath }) => {
    if (!workspacePath) {
      return { success: false, error: '路径不能为空' }
    }
    try {
      const errorMessage = await shell.openPath(workspacePath)
      if (errorMessage) {
        // shell.openPath 失败时返回错误字符串，成功时返回空字符串
        return { success: false, error: errorMessage }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 重命名工作区文件夹并同步更新数据库中的 workspacePath
  ipcMain.handle('workspace:rename', wrapWorkspaceCall(async (_event, { oldPath, newName }) => {
    if (!oldPath || !newName || newName.trim().length === 0) {
      throw new WorkspaceError('INVALID_PARAMS', '原路径和新名称不能为空', false)
    }
    const trimmedName = newName.trim()
    // 禁止路径分隔符等非法字符
    if (/[\\/:*?"<>|]/.test(trimmedName)) {
      throw new WorkspaceError('INVALID_PARAMS', '名称包含非法字符', false)
    }
    const parentDir = path.dirname(oldPath)
    const newPath = path.join(parentDir, trimmedName)
    if (newPath === oldPath) {
      return { success: true, newPath }
    }
    try {
      // 检查目标是否已存在
      try {
        await fs.promises.access(newPath)
        throw new WorkspaceError('ALREADY_EXISTS', '目标文件夹已存在', false)
      } catch (err) {
        if (err instanceof WorkspaceError) throw err
        // access 失败说明目标不存在，继续
      }
      await fs.promises.rename(oldPath, newPath)
    } catch (err) {
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('RENAME_FAILED', `重命名失败: ${err.message}`, false)
    }
    // 同步更新数据库中所有相关会话的 workspacePath
    try {
      const { ChatSession } = require('../db/database')
      await ChatSession.update(
        { workspacePath: newPath },
        { where: { workspacePath: oldPath } }
      )
    } catch (err) {
      console.error('[workspace:rename] 更新 ChatSession 失败:', err)
      // 即使 DB 更新失败，文件夹已重命名，返回成功但带警告
    }
    // 如果当前打开的是这个工作区，同步 workspaceManager 内部状态
    const current = refs.workspaceManager.current()
    if (current && current.path === oldPath) {
      try {
        await refs.workspaceManager.open(newPath)
        if (refs.wikiEngine) {
          refs.workspaceManager.watch(refs.wikiEngine)
        }
      } catch (err) {
        console.warn('[workspace:rename] 重新打开当前工作区失败:', err)
      }
    }
    return { success: true, newPath }
  }))

  // Task 1.10: workspace:ingest - 调 WikiEngine.ingest 读源文件 → 写 wiki/sources/<slug>.md
  ipcMain.handle('workspace:ingest', wrapWorkspaceCall(async (event, { filename }) => {
    if (!refs.wikiEngine) {
      throw new WorkspaceError('NOT_OPEN', 'WikiEngine 未初始化（请重启应用）', false)
    }
    return await refs.wikiEngine.ingest({ filename })
  }))

  // v9.1.0 补充：workspace:ingestBatch - 批量导入（带进度推送 + 取消）
  ipcMain.handle('workspace:ingestBatch', wrapWorkspaceCall(async (event, { filenames }) => {
    if (!refs.wikiEngine) {
      throw new WorkspaceError('NOT_OPEN', 'WikiEngine 未初始化（请重启应用）', false)
    }
    if (!Array.isArray(filenames) || filenames.length === 0) {
      throw new WorkspaceError('INVALID_PARAMS', '至少选择一个文件', false)
    }

    const batchId = generateBatchId()
    const controller = new AbortController()
    const startTime = Date.now()
    batchRuns.set(batchId, { controller, startTime, total: filenames.length })

    const sender = event.sender
    const sendProgress = (payload) => {
      if (sender.isDestroyed()) return
      sender.send('workspace:ingestBatch-progress', { batchId, ...payload })
    }
    const sendDone = (payload) => {
      if (sender.isDestroyed()) return
      sender.send('workspace:ingestBatch-done', { batchId, ...payload })
    }

    // 立即返回启动结果，后台继续执行并推送进度
    process.nextTick(async () => {
      try {
        const result = await refs.wikiEngine.ingestBatch({
          filenames,
          signal: controller.signal,
          onProgress: (progress) => sendProgress(progress)
        })
        sendDone(result)
      } catch (err) {
        sendDone({
          status: 'failed',
          total: filenames.length,
          succeeded: 0,
          failed: filenames.length,
          errors: [{ error: err.message || String(err) }],
          durationMs: Date.now() - startTime,
          cancelled: false,
          errorMessage: err.message || String(err)
        })
      } finally {
        batchRuns.delete(batchId)
      }
    })

    return { batchId, status: 'started', total: filenames.length }
  }))

  // v9.1.0 补充：workspace:ingestBatch-cancel - 取消运行中的批量导入
  ipcMain.handle('workspace:ingestBatch-cancel', wrapWorkspaceCall(async (_event, { batchId }) => {
    const run = batchRuns.get(batchId)
    if (!run) {
      return { success: true, cancelled: false, message: '无运行中的批量导入' }
    }
    run.controller.abort()
    return { success: true, cancelled: true, batchId }
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
      wikiEngine: refs.wikiEngine,
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