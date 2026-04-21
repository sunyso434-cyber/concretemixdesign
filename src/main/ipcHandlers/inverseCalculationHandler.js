const { ipcMain } = require('electron')
const InverseCalculationService = require('../services/InverseCalculationService')

class InverseCalculationHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // Excel 导入
    ipcMain.handle('inverseCalculation.importExcel', async (_, { filePath }) => {
      try {
        console.log('[InverseCalculationHandler] 收到导入Excel请求:', filePath)
        if (!filePath || typeof filePath !== 'string') {
          console.error('[InverseCalculationHandler] filePath无效:', filePath)
          return { success: false, error: 'filePath参数缺失或无效' }
        }
        const data = await InverseCalculationService.importExcel(filePath)
        console.log('[InverseCalculationHandler] Excel导入成功, 数据条数:', data?.length)
        return { success: true, data }
      } catch (error) {
        console.error('[InverseCalculationHandler] Excel导入失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 执行回归计算
    ipcMain.handle('inverseCalculation.calculate', async (_, params) => {
      try {
        console.log('[InverseCalculationHandler] 收到回归计算请求')
        if (!params || typeof params !== 'object') {
          console.error('[InverseCalculationHandler] params参数无效:', params)
          return { success: false, error: 'params参数缺失或无效' }
        }
        const result = await InverseCalculationService.calculate(params)
        console.log('[InverseCalculationHandler] 回归计算成功')
        return { success: true, result }
      } catch (error) {
        console.error('[InverseCalculationHandler] 回归计算失败:', error)
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new InverseCalculationHandler()