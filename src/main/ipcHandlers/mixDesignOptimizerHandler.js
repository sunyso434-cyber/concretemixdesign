const { ipcMain } = require('electron')
const MixDesignOptimizer = require('../services/MixDesignOptimizer')
const OptimizationHistory = require('../db/models/OptimizationHistory')

// 存储正在进行的优化任务
const activeOptimizationTasks = new Map()

// 生成唯一任务ID
const generateTaskId = () => `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

class MixDesignOptimizerHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    /**
     * 优化配合比设计 - 成本最优（支持后台运行和取消）
     * @param {Object} event - IPC 事件
     * @param {Object} params - 优化参数
     * @param {boolean} params.background - 是否后台运行
     */
    ipcMain.handle('optimizeMixDesign', async (event, params) => {
      const isBackground = params.background === true

      // 如果是后台模式，立即返回 taskId
      if (isBackground) {
        const taskId = generateTaskId()
        // 创建取消标志
        const cancellationToken = { cancelled: false }
        activeOptimizationTasks.set(taskId, { cancellationToken, status: 'running' })

        // 在后台运行优化
        this.runOptimizationInBackground(taskId, params, cancellationToken, event)

        return { success: true, taskId, status: 'running' }
      }

      // 同步模式（原有行为）
      try {
        const progressOptimizer = new MixDesignOptimizer((progress) => {
          event.sender.send('optimization-progress', progress)
        })
        const result = await progressOptimizer.optimizeMixDesign(params)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    /**
     * 取消优化任务
     * @param {Object} event - IPC 事件
     * @param {string} taskId - 任务ID
     */
    ipcMain.handle('cancelOptimization', async (_, taskId) => {
      const task = activeOptimizationTasks.get(taskId)
      if (!task) {
        return { success: false, error: '任务不存在或已完成' }
      }
      task.cancellationToken.cancelled = true
      task.status = 'cancelled'
      return { success: true }
    })

    /**
     * 查询优化任务状态
     * @param {Object} event - IPC 事件
     * @param {string} taskId - 任务ID
     */
    ipcMain.handle('getOptimizationTaskStatus', async (_, taskId) => {
      const task = activeOptimizationTasks.get(taskId)
      if (!task) {
        return { success: false, error: '任务不存在' }
      }
      return { success: true, status: task.status, result: task.result || null }
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

  /**
   * 在后台运行优化任务
   */
  async runOptimizationInBackground(taskId, params, cancellationToken, event) {
    try {
      const optimizer = new MixDesignOptimizer((progress) => {
        if (!cancellationToken.cancelled) {
          event.sender.send('optimization-progress', { ...progress, taskId })
        }
      })

      // 传递 cancellationToken 给优化器
      const result = await optimizer.optimizeMixDesign(params, cancellationToken)

      const task = activeOptimizationTasks.get(taskId)
      if (task) {
        task.status = 'completed'
        task.result = result
      }

      // 通知前端优化完成
      event.sender.send('optimization-completed', { taskId, result })
    } catch (error) {
      const task = activeOptimizationTasks.get(taskId)
      if (task) {
        task.status = error.message === 'cancelled' ? 'cancelled' : 'failed'
        task.error = error.message
      }

      // 通知前端优化失败
      event.sender.send('optimization-failed', { taskId, error: error.message })
    }
  }
}

module.exports = new MixDesignOptimizerHandler()
