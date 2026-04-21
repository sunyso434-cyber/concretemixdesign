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
        const data = await InverseCalculationService.importExcel(filePath)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 执行回归计算
    ipcMain.handle('inverseCalculation.calculate', async (_, params) => {
      try {
        const result = await InverseCalculationService.calculate(params)
        return { success: true, result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new InverseCalculationHandler()