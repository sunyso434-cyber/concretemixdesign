/**
 * trainingHandler.js
 * 训练 IPC 处理器（薄包装）：全部训练逻辑委托给 TrainingRunner（单一来源）
 *
 * 职责：
 *   1. training:run         - 启动训练（委托 TrainingRunner.runTraining）
 *   2. training:getStatus   - 查询训练状态（TrainingRunner.isTraining + activeCount）
 *   3. training:rollback    - 回滚到指定版本（TrainingRunner.rollbackToVersion）
 *   4. training:getInfo     - 当前模型信息 + 训练数据统计 + 历史版本
 *   5. training:previewArchivedMetrics - 预览归档版本指标
 *   6. training:progress    - (event) 透传训练进度（结构化 {message, percent, timestamp}）
 *
 * 依赖 Task C1: XGBoostTrainingService（Worker Thread）
 * 依赖 Task C3: 训练锁（TrainingRunner.isTraining，单一来源）
 * 审查 M3: 回滚用文件复制
 * 审查 M4: 训练锁防并发
 * 审查 N3: Worker Thread 执行，不阻塞主进程
 */

const { ipcMain } = require('electron')
const TrainingRunner = require('../services/training/TrainingRunner')
const XGBoostTrainingService = require('../services/XGBoostTrainingService')

function registerHandlers() {
  // ============ training:run ============
  ipcMain.handle('training:run', async (event, options = {}) => {
    console.log('[Training] training:run 被调用')

    // 进度透传：原样转发结构化对象（{message, percent, timestamp}），不丢字段
    const sendProgress = (data) => {
      try {
        event.sender.send('training:progress', data)
      } catch (e) {
        console.warn('[Training] 渲染进程已断开，跳过进度消息:', e.message)
      }
    }

    const result = await TrainingRunner.runTraining(options, sendProgress)
    console.log(`[Training] training:run 完成: success=${result.success}`)
    return result
  })

  // ============ training:getStatus ============
  ipcMain.handle('training:getStatus', async () => {
    return {
      isTraining: TrainingRunner.isTraining,
      activeCount: XGBoostTrainingService.activeCount
    }
  })

  // ============ training:getInfo ============
  ipcMain.handle('training:getInfo', async () => {
    const models = TrainingRunner.getCurrentModelSummary()
    const summary = TrainingRunner.getModelStateSummary()
    const history = TrainingRunner.listArchiveVersions()

    // 获取试配数据条数（Sequelize 范式，避免裸 SQL）
    let trialRecordCount = 0
    try {
      const TrialTestRecord = require('../db/models/TrialTestRecord')
      trialRecordCount = await TrialTestRecord.count()
    } catch (e) {
      // 表不存在时返回 0
      trialRecordCount = 0
    }

    return {
      success: true,
      models,
      summary,
      history,
      trialRecordCount,
      csvPath: TrainingRunner.getBaseTrainingCsvPath()
    }
  })

  // ============ training:rollback ============
  ipcMain.handle('training:rollback', async (event, { version } = {}) => {
    console.log('[Training] training:rollback', version || '回滚到上一版本')

    try {
      let targetVersion = version

      if (!targetVersion) {
        // 未指定版本，回滚到最新归档
        const versions = TrainingRunner.listArchiveVersions()
        if (versions.length === 0) {
          return { success: false, error: '没有可回滚的历史版本' }
        }
        targetVersion = versions[0].version
      }

      const result = TrainingRunner.rollbackToVersion(targetVersion)
      return { success: true, ...result }
    } catch (error) {
      console.error('[Training] 回滚失败:', error)
      return { success: false, error: error.message }
    }
  })

  // ============ training:previewArchivedMetrics ============
  ipcMain.handle('training:previewArchivedMetrics', async (event, { version }) => {
    return TrainingRunner.previewArchivedMetrics(version)
  })

  console.log('[Training] IPC 处理器已注册')
}

module.exports = { registerHandlers }
