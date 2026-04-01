const { ipcMain } = require('electron')
const systemService = require('../services/SystemService')

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
  }
}

module.exports = new SystemHandler()