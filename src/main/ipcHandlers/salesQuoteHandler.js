const { ipcMain } = require('electron')
const SalesQuoteCalculationService = require('../services/SalesQuoteCalculationService')

class SalesQuoteHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // v10.10 重写：calculate 接受 mode='reverse'|'forward'，调对应算法
    ipcMain.handle('salesQuote:calculate', async (_, payload = {}) => {
      try {
        const { mode = 'reverse', ...rest } = payload
        let data
        if (mode === 'reverse') {
          data = SalesQuoteCalculationService.calculateReverse(rest)
        } else if (mode === 'forward') {
          data = SalesQuoteCalculationService.calculateForward(rest)
        } else {
          return { success: false, error: `未知 mode: ${mode}，仅支持 reverse / forward` }
        }
        return { success: true, mode, data }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 泵送费清单（保留：与 SalesQuoteExportService 无关，独立功能）
    ipcMain.handle('salesQuote:listPumpingFeeItems', async () => {
      try {
        const PumpingFeeService = require('../services/PumpingFeeService')
        return { success: true, data: await PumpingFeeService.listItems() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:createPumpingFeeItem', async (_, data) => {
      try {
        const PumpingFeeService = require('../services/PumpingFeeService')
        return { success: true, data: await PumpingFeeService.createItem(data) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:updatePumpingFeeItem', async (_, { id, data }) => {
      try {
        const PumpingFeeService = require('../services/PumpingFeeService')
        return { success: true, data: await PumpingFeeService.updateItem(id, data) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:deletePumpingFeeItem', async (_, id) => {
      try {
        const PumpingFeeService = require('../services/PumpingFeeService')
        await PumpingFeeService.deleteItem(id)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:listEnabledPumpingFeeItems', async () => {
      try {
        const PumpingFeeService = require('../services/PumpingFeeService')
        return { success: true, data: await PumpingFeeService.listEnabled() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 报价历史（保留：双模式共用）
    ipcMain.handle('salesQuote:saveQuote', async (_, data) => {
      try {
        const SalesQuoteHistoryService = require('../services/SalesQuoteHistoryService')
        return { success: true, data: await SalesQuoteHistoryService.saveQuote(data) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:listHistory', async (_, filters) => {
      try {
        const SalesQuoteHistoryService = require('../services/SalesQuoteHistoryService')
        return { success: true, ...(await SalesQuoteHistoryService.listHistory(filters || {})) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:deleteQuote', async (_, id) => {
      try {
        const SalesQuoteHistoryService = require('../services/SalesQuoteHistoryService')
        await SalesQuoteHistoryService.deleteQuote(id)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new SalesQuoteHandler()
