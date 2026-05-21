const { ipcMain } = require('electron')
const BasicMixDesignService = require('../services/BasicMixDesignService')
const SalesQuoteRuleService = require('../services/SalesQuoteRuleService')
const SalesQuoteCalculationService = require('../services/SalesQuoteCalculationService')
const SalesQuoteExportService = require('../services/SalesQuoteExportService')

class SalesQuoteHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    ipcMain.handle('salesQuote:listBasicMixDesigns', async (_, filters) => {
      try {
        const rows = await BasicMixDesignService.listBasicMixDesigns(filters || {})
        return { success: true, data: rows.map(row => row.toJSON()) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:createBasicMixDesign', async (_, data) => {
      try {
        const row = await BasicMixDesignService.createBasicMixDesign(data)
        return { success: true, data: row.toJSON() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:listRules', async () => {
      try {
        return { success: true, data: await SalesQuoteRuleService.listRules() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:updateRule', async (_, { id, data }) => {
      try {
        const row = await SalesQuoteRuleService.updateRule(id, data)
        return { success: true, data: row.toJSON() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:calculate', async (_, payload) => {
      try {
        return { success: true, data: SalesQuoteCalculationService.calculate(payload) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('salesQuote:exportExcel', async (_, payload) => {
      try {
        return { success: true, data: await SalesQuoteExportService.exportQuoteToExcel(payload) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new SalesQuoteHandler()
