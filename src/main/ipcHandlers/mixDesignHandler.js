const { ipcMain } = require('electron')
const MixDesignService = require('../services/MixDesignService/index')

class MixDesignHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // 获取所有配合比方案（支持过滤：excludeDrafts, onlyDrafts）
    ipcMain.handle('getAllMixDesigns', async (_, options) => {
      try {
        const mixDesigns = await MixDesignService.getAllMixDesigns(options || {})
        // 将 Sequelize 模型实例转换为普通 JavaScript 对象
        const plainMixDesigns = mixDesigns.map(mixDesign => mixDesign.toJSON())
        return { success: true, data: plainMixDesigns }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 根据ID获取配合比方案
    ipcMain.handle('getMixDesignById', async (_, id) => {
      try {
        const mixDesign = await MixDesignService.getMixDesignById(id)
        // 将 Sequelize 模型实例转换为普通 JavaScript 对象
        const plainMixDesign = mixDesign ? mixDesign.toJSON() : null
        return { success: true, data: plainMixDesign }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 创建配合比方案
    ipcMain.handle('createMixDesign', async (_, data) => {
      try {
        const mixDesign = await MixDesignService.createMixDesign(data)
        // 将 Sequelize 模型实例转换为普通 JavaScript 对象
        const plainMixDesign = mixDesign.toJSON()
        return { success: true, data: plainMixDesign }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 更新配合比方案
    ipcMain.handle('updateMixDesign', async (_, { id, data }) => {
      try {
        const mixDesign = await MixDesignService.updateMixDesign(id, data)
        // 将 Sequelize 模型实例转换为普通 JavaScript 对象
        const plainMixDesign = mixDesign.toJSON()
        return { success: true, data: plainMixDesign }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 删除配合比方案
    ipcMain.handle('deleteMixDesign', async (_, id) => {
      try {
        await MixDesignService.deleteMixDesign(id)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 计算配合比
    ipcMain.handle('calculateMixDesign', async (_, params) => {
      try {
        const result = await MixDesignService.calculateMixDesign(params)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 计算系列配合比（批量计算）
    ipcMain.handle('calculateSeriesMixDesign', async (_, { baseParams, strengthRange }) => {
      try {
        const results = await MixDesignService.calculateSeriesMixDesign(baseParams, strengthRange)
        return { success: true, data: results }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 批量保存系列配合比方案
    ipcMain.handle('batchSaveSeriesMixDesigns', async (_, { designs, saveValues }) => {
      try {
        const savedDesigns = []
        for (const design of designs) {
          const mixDesignData = {
            ...saveValues,
            ...design,
            tempSettings: design.tempSettings,
            status: '未验证'
          }
          const saved = await MixDesignService.createMixDesign(mixDesignData)
          savedDesigns.push(saved.toJSON())
        }
        return { success: true, data: savedDesigns }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 验证配合比
    ipcMain.handle('validateMixDesign', async (_, mixDesign) => {
      try {
        const result = await MixDesignService.validateMixDesign(mixDesign)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MixDesignHandler()
