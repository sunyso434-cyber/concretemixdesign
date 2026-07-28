const { ipcMain } = require('electron')
const MaterialService = require('../services/MaterialService')
const MaterialBatchService = require('../services/MaterialBatchService')

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
        console.error('getAllMaterials failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 根据ID获取原材料
    ipcMain.handle('getMaterialById', async (_, id) => {
      try {
        const material = await MaterialService.getMaterialById(id)
        return { success: true, data: material }
      } catch (error) {
        console.error('getMaterialById failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 创建原材料
    ipcMain.handle('createMaterial', async (_, data) => {
      try {
        const material = await MaterialService.createMaterial(data)
        return { success: true, data: material }
      } catch (error) {
        console.error('createMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新原材料
    ipcMain.handle('updateMaterial', async (_, { id, data }) => {
      try {
        const material = await MaterialService.updateMaterial(id, data)
        return { success: true, data: material }
      } catch (error) {
        console.error('updateMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 删除原材料
    ipcMain.handle('deleteMaterial', async (_, id) => {
      try {
        await MaterialService.deleteMaterial(id)
        return { success: true }
      } catch (error) {
        console.error('deleteMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 根据类型获取原材料
    ipcMain.handle('getMaterialsByType', async (_, type) => {
      try {
        const materials = await MaterialService.getMaterialsByType(type)
        return { success: true, data: materials }
      } catch (error) {
        console.error('getMaterialsByType failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 根据名称匹配原材料
    ipcMain.handle('matchMaterialByName', async (_, { type, name }) => {
      try {
        const material = await MaterialService.matchMaterialByName(type, name)
        return { success: true, data: material }
      } catch (error) {
        console.error('matchMaterialByName failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 初始化预设材料
    ipcMain.handle('initDefaultMaterials', async () => {
      try {
        await MaterialService.initDefaultMaterials()
        return { success: true }
      } catch (error) {
        console.error('initDefaultMaterials failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ==================== 批次管理 IPC ====================
    ipcMain.handle('material:getBatches', async (event, { materialId }) => {
      try {
        const batches = await MaterialBatchService.getBatchesByMaterialId(materialId)
        return { success: true, data: batches }
      } catch (error) {
        console.error('material:getBatches failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:getBatchById', async (event, { id }) => {
      try {
        const batch = await MaterialBatchService.getBatchById(id)
        return { success: true, data: batch }
      } catch (error) {
        console.error('material:getBatchById failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:getCurrentBatch', async (event, { materialId }) => {
      try {
        const batch = await MaterialBatchService.getCurrentBatch(materialId)
        return { success: true, data: batch }
      } catch (error) {
        console.error('material:getCurrentBatch failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:createBatch', async (event, data) => {
      try {
        const batch = await MaterialBatchService.createBatch(data)
        return { success: true, data: batch }
      } catch (error) {
        console.error('material:createBatch failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:updateBatch', async (event, { id, ...data }) => {
      try {
        const batch = await MaterialBatchService.updateBatch(id, data)
        return { success: true, data: batch }
      } catch (error) {
        console.error('material:updateBatch failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:deleteBatch', async (event, { id }) => {
      try {
        await MaterialBatchService.deleteBatch(id)
        return { success: true }
      } catch (error) {
        console.error('material:deleteBatch failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:setCurrentBatch', async (event, { materialId, batchId }) => {
      try {
        const batch = await MaterialBatchService.setCurrentBatch(materialId, batchId)
        return { success: true, data: batch }
      } catch (error) {
        console.error('material:setCurrentBatch failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('material:getExpiringBatches', async () => {
      try {
        const batches = await MaterialBatchService.getExpiringBatches()
        return { success: true, data: batches }
      } catch (error) {
        console.error('material:getExpiringBatches failed:', error)
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MaterialHandler()
