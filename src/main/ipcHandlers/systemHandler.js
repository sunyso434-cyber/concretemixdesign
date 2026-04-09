const { ipcMain } = require('electron')
const systemService = require('../services/SystemService')
const backgroundTaskService = require('../services/BackgroundTaskService')

class SystemHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // 获取所有系统参数
    ipcMain.handle('get-all-params', async () => {
      try {
        console.log('收到获取所有系统参数的请求')
        const params = await systemService.getAllParams()
        console.log('获取到系统参数:', params.length, '个')
        console.log('系统参数详情:', params)
        return { success: true, data: params }
      } catch (error) {
        console.error('获取系统参数失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 根据名称获取系统参数
    ipcMain.handle('get-param-by-name', async (_, name) => {
      try {
        const param = await systemService.getParamByName(name)
        return { success: true, data: param }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 设置系统参数
    ipcMain.handle('set-param', async (_, { name, value, type, description }) => {
      try {
        const param = await systemService.setParam(name, value, type, description)
        return { success: true, data: param }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 删除系统参数
    ipcMain.handle('delete-param', async (_, name) => {
      try {
        await systemService.deleteParam(name)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 备份数据库
    ipcMain.handle('backup-database', async () => {
      try {
        const backupPath = await systemService.backupDatabase()
        return { success: true, data: backupPath }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 恢复数据库
    ipcMain.handle('restore-database', async (_, backupPath) => {
      try {
        await systemService.restoreDatabase(backupPath)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 导入数据
    ipcMain.handle('import-data', async (_, filePath) => {
      try {
        await systemService.importData(filePath)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 导出数据
    ipcMain.handle('export-data', async (_, filePath) => {
      try {
        await systemService.exportData(filePath)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // ========== 后台任务相关 ==========

    // 获取所有后台任务状态
    ipcMain.handle('get-all-tasks', async () => {
      return { success: true, data: backgroundTaskService.getAllTasks() }
    })

    // 获取单个任务状态
    ipcMain.handle('get-task-status', async (_, id) => {
      return { success: true, data: backgroundTaskService.getTask(id) }
    })

    // 取消任务
    ipcMain.handle('cancel-task', async (_, id) => {
      const ok = backgroundTaskService.cancelTask(id)
      return { success: true, cancelled: ok }
    })

    // 删除任务记录
    ipcMain.handle('clear-task', async (_, id) => {
      backgroundTaskService.clearTask(id)
      return { success: true }
    })

    // 文件对话框相关
    ipcMain.handle('show-save-dialog', async (_, options) => {
      const { dialog } = require('electron')
      const result = await dialog.showSaveDialog(options)
      return { success: true, data: result }
    })

    ipcMain.handle('show-open-dialog', async (_, options) => {
      const { dialog } = require('electron')
      const result = await dialog.showOpenDialog(options)
      return { success: true, data: result }
    })

    // ========== 任务启动通道 ==========

    // 启动备份任务（后台）
    ipcMain.handle('start-backup-task', async (_, filePath) => {
      try {
        const taskId = backgroundTaskService.startTask('backup', '正在备份数据库...', async (onProgress) => {
          return await systemService.backupDatabaseToFile(filePath, onProgress)
        })
        return { success: true, data: { taskId } }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 启动恢复任务
    ipcMain.handle('start-restore-task', async (_, backupPath) => {
      console.log('[SystemHandler] start-restore-task called with path:', backupPath)
      try {
        const taskId = backgroundTaskService.startTask('restore', '正在恢复数据库...', async (onProgress) => {
          console.log('[SystemHandler] Restore task started, calling restoreDatabaseFromFile')
          await systemService.restoreDatabaseFromFile(backupPath, onProgress)
          console.log('[SystemHandler] restoreDatabaseFromFile completed')
          return true
        })
        console.log('[SystemHandler] Restore task created with ID:', taskId)
        return { success: true, data: { taskId } }
      } catch (error) {
        console.error('[SystemHandler] start-restore-task error:', error)
        return { success: false, error: error.message }
      }
    })

    // 启动导出任务
    ipcMain.handle('start-export-task', async (_, { types, format, filePath }) => {
      try {
        const taskId = backgroundTaskService.startTask('export', '正在导出数据...', async (onProgress) => {
          return await systemService.exportData(null, { types, format, filePath }, onProgress)
        })
        return { success: true, data: { taskId } }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 启动导入任务
    ipcMain.handle('start-import-task', async (_, { type, filePath }) => {
      try {
        const taskId = backgroundTaskService.startTask('import', '正在导入数据...', async (onProgress) => {
          return await systemService.importData(null, { type, filePath }, onProgress)
        })
        return { success: true, data: { taskId } }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 生成导入模板
    ipcMain.handle('generate-import-template', async (_, { type, filePath }) => {
      try {
        await systemService.generateImportTemplate(type, filePath)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 解析导入文件
    ipcMain.handle('parse-import-file', async (_, filePath) => {
      try {
        const result = await systemService.parseImportFile(filePath)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 获取 App 版本
    ipcMain.handle('get-app-version', async () => {
      const { app } = require('electron')
      return { success: true, data: app.getVersion() }
    })
  }
}

module.exports = new SystemHandler()