const { ipcMain } = require('electron')
const InsulationMaterialService = require('../services/InsulationMaterialService')

class MassConcreteHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // ========== 保温材料管理 ==========

    // 获取所有保温材料
    ipcMain.handle('mc_getAllInsulationMaterials', async () => {
      try {
        const materials = await InsulationMaterialService.getAllMaterials()
        return { success: true, data: materials }
      } catch (error) {
        console.error('mc_getAllInsulationMaterials failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取默认保温材料
    ipcMain.handle('mc_getDefaultInsulationMaterials', async () => {
      try {
        const materials = await InsulationMaterialService.getDefaultMaterials()
        return { success: true, data: materials }
      } catch (error) {
        console.error('mc_getDefaultInsulationMaterials failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取保温材料详情
    ipcMain.handle('mc_getInsulationMaterialById', async (_, id) => {
      try {
        const material = await InsulationMaterialService.getMaterialById(id)
        return { success: true, data: material }
      } catch (error) {
        console.error('mc_getInsulationMaterialById failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 创建保温材料
    ipcMain.handle('mc_createInsulationMaterial', async (_, data) => {
      try {
        const material = await InsulationMaterialService.createMaterial(data)
        return { success: true, data: material }
      } catch (error) {
        console.error('mc_createInsulationMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新保温材料
    ipcMain.handle('mc_updateInsulationMaterial', async (_, { id, data }) => {
      try {
        const material = await InsulationMaterialService.updateMaterial(id, data)
        return { success: true, data: material }
      } catch (error) {
        console.error('mc_updateInsulationMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 删除保温材料
    ipcMain.handle('mc_deleteInsulationMaterial', async (_, id) => {
      try {
        await InsulationMaterialService.deleteMaterial(id)
        return { success: true }
      } catch (error) {
        console.error('mc_deleteInsulationMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 方案管理 ==========

    // 获取所有方案
    ipcMain.handle('mc_getAllSchemes', async () => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const schemes = await MassConcreteSchemeService.getAllSchemes()
        return { success: true, data: schemes }
      } catch (error) {
        console.error('mc_getAllSchemes failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取方案详情
    ipcMain.handle('mc_getSchemeById', async (_, id) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const scheme = await MassConcreteSchemeService.getSchemeById(id)
        return { success: true, data: scheme }
      } catch (error) {
        console.error('mc_getSchemeById failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 创建方案
    ipcMain.handle('mc_createScheme', async (_, data) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const scheme = await MassConcreteSchemeService.createScheme(data)
        return { success: true, data: scheme }
      } catch (error) {
        console.error('mc_createScheme failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新方案
    ipcMain.handle('mc_updateScheme', async (_, { id, data }) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const scheme = await MassConcreteSchemeService.updateScheme(id, data)
        return { success: true, data: scheme }
      } catch (error) {
        console.error('mc_updateScheme failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 删除方案
    ipcMain.handle('mc_deleteScheme', async (_, id) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        await MassConcreteSchemeService.deleteScheme(id)
        return { success: true }
      } catch (error) {
        console.error('mc_deleteScheme failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 配合比设计 ==========

    // 计算配合比
    ipcMain.handle('mc_calculateMixDesign', async (_, data) => {
      try {
        const MassConcreteMixDesignService = require('../services/MassConcreteMixDesignService')
        const result = await MassConcreteMixDesignService.calculateMixDesign(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateMixDesign failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存配合比
    ipcMain.handle('mc_saveMixDesign', async (_, data) => {
      try {
        const MassConcreteMixDesignService = require('../services/MassConcreteMixDesignService')
        const result = await MassConcreteMixDesignService.saveMixDesign(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveMixDesign failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 从配合比导入
    ipcMain.handle('mc_importFromMixDesign', async (_, mixDesignId) => {
      try {
        const MassConcreteMixDesignService = require('../services/MassConcreteMixDesignService')
        const result = await MassConcreteMixDesignService.importFromMixDesign(mixDesignId)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_importFromMixDesign failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 绝热温升 ==========

    // 计算绝热温升
    ipcMain.handle('mc_calculateAdiabaticTemp', async (_, data) => {
      try {
        const MassConcreteAdiabaticTempService = require('../services/MassConcreteAdiabaticTempService')
        const result = await MassConcreteAdiabaticTempService.calculateAdiabaticTemp(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateAdiabaticTemp failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存绝热温升
    ipcMain.handle('mc_saveAdiabaticTemp', async (_, data) => {
      try {
        const MassConcreteAdiabaticTempService = require('../services/MassConcreteAdiabaticTempService')
        const result = await MassConcreteAdiabaticTempService.saveAdiabaticTemp(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveAdiabaticTemp failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 温度应力 ==========

    // 计算温度应力
    ipcMain.handle('mc_calculateStress', async (_, data) => {
      try {
        const MassConcreteStressService = require('../services/MassConcreteStressService')
        const result = await MassConcreteStressService.calculateStress(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateStress failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存温度应力
    ipcMain.handle('mc_saveStress', async (_, data) => {
      try {
        const MassConcreteStressService = require('../services/MassConcreteStressService')
        const result = await MassConcreteStressService.saveStress(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveStress failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 保温计算 ==========

    // 计算保温
    ipcMain.handle('mc_calculateInsulation', async (_, data) => {
      try {
        const MassConcreteInsulationService = require('../services/MassConcreteInsulationService')
        const result = await MassConcreteInsulationService.calculateInsulation(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateInsulation failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存保温
    ipcMain.handle('mc_saveInsulation', async (_, data) => {
      try {
        const MassConcreteInsulationService = require('../services/MassConcreteInsulationService')
        const result = await MassConcreteInsulationService.saveInsulation(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveInsulation failed:', error)
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MassConcreteHandler()