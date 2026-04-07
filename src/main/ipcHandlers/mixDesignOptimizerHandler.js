const { ipcMain } = require('electron')
const MixDesignOptimizer = require('../services/MixDesignOptimizer')
const OptimizationHistory = require('../db/models/OptimizationHistory')

class MixDesignOptimizerHandler {
  constructor() {
    this.optimizer = new MixDesignOptimizer()
    this.registerHandlers()
  }

  registerHandlers() {
    /**
     * 优化配合比设计 - 成本最优
     * @param {Object} event - IPC 事件
     * @param {Object} params - 优化参数
     * @param {Object} params.constraints - 性能目标约束
     * @param {Object} params.userLimits - 用户自定义限值
     */
    ipcMain.handle('optimizeMixDesign', async (_, params) => {
      try {
        const result = await this.optimizer.optimizeMixDesign(params)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    /**
     * 获取优化历史记录
     */
    ipcMain.handle('getOptimizationHistory', async () => {
      try {
        const records = await OptimizationHistory.findAll({
          order: [['createdAt', 'DESC']],
          limit: 50
        })
        const plainRecords = records.map(r => r.toJSON())
        return { success: true, data: plainRecords }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    /**
     * 根据 ID 获取优化历史记录
     * @param {Object} event - IPC 事件
     * @param {number} id - 历史记录 ID
     */
    ipcMain.handle('getOptimizationHistoryById', async (_, id) => {
      try {
        const record = await OptimizationHistory.findByPk(id)
        const plainRecord = record ? record.toJSON() : null
        return { success: true, data: plainRecord }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    /**
     * 删除优化历史记录
     * @param {Object} event - IPC 事件
     * @param {number} id - 历史记录 ID
     */
    ipcMain.handle('deleteOptimizationHistory', async (_, id) => {
      try {
        await OptimizationHistory.destroy({ where: { id } })
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MixDesignOptimizerHandler()
