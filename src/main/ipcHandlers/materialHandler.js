const { ipcMain } = require('electron')
const MaterialService = require('../services/MaterialService')

class MaterialHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // 获取所有原材料
    ipcMain.handle('getAllMaterials', async () => {
      try {
        const materials = await MaterialService.getAllMaterials()
        return { success: true, data: materials }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 根据ID获取原材料
    ipcMain.handle('getMaterialById', async (_, id) => {
      try {
        const material = await MaterialService.getMaterialById(id)
        return { success: true, data: material }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 创建原材料
    ipcMain.handle('createMaterial', async (_, data) => {
      try {
        const material = await MaterialService.createMaterial(data)
        return { success: true, data: material }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 更新原材料
    ipcMain.handle('updateMaterial', async (_, { id, data }) => {
      try {
        const material = await MaterialService.updateMaterial(id, data)
        return { success: true, data: material }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 删除原材料
    ipcMain.handle('deleteMaterial', async (_, id) => {
      try {
        await MaterialService.deleteMaterial(id)
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 根据类型获取原材料
    ipcMain.handle('getMaterialsByType', async (_, type) => {
      try {
        const materials = await MaterialService.getMaterialsByType(type)
        return { success: true, data: materials }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 初始化预设材料
    ipcMain.handle('initDefaultMaterials', async () => {
      try {
        await MaterialService.initDefaultMaterials()
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MaterialHandler()
