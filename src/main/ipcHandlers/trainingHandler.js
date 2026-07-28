/**
 * trainingHandler.js
 * 训练 IPC 处理器：管理训练生命周期 + 并发锁
 *
 * IPC 通道：
 *   training:run          — 启动训练（含锁检查）
 *   training:getStatus    — 查询训练状态
 *   training:rollback     — 回滚指定目标的模型
 *
 * 依赖：
 *   TrainingDataBuilder    — 从 TrialTestRecord 拼装训练 CSV
 *   XGBoostTrainingService — Worker Thread 执行 XGBoost 训练
 *   ModelVersionManager    — 模型版本归档/保存/回滚
 *   XGBoostPredictionService — 预测缓存管理
 */

const path = require('path')
const fs = require('fs')
const TrainingDataBuilder = require('../services/training/TrainingDataBuilder')
const XGBoostTrainingService = require('../services/XGBoostTrainingService')
const ModelVersionManager = require('../services/training/ModelVersionManager')
const XGBoostPredictionService = require('../services/XGBoostPredictionService')

// ============ 训练锁（进程级单例） ============

let isTraining = false

// ============ IPC Handlers ============

/**
 * 启动训练
 *
 * 流程：
 *   1. 检查锁 → 拼装数据 → 检查数据量
 *   2. 生成版本号 → 写入临时 CSV
 *   3. Worker Thread 训练（含进度回调）
 *   4. 保存模型 → 清空预测缓存
 *   5. 标记试配记录 → 返回结果
 */
async function handleTrainingRun(event, options) {
  if (isTraining) {
    return { success: false, error: '训练进行中，请稍后' }
  }

  isTraining = true
  try {
    // 1. 拼装训练数据
    const builder = new TrainingDataBuilder()
    const dataResult = await builder.buildFromTrialRecords({ exportCsv: false })

    // 检查数据量
    if (dataResult.totalRows < 20) {
      return {
        success: false,
        error: `试配数据不足20条（当前${dataResult.totalRows}条），请录入更多试配记录`
      }
    }

    // 2. 生成版本号
    const modelVersion = ModelVersionManager.generateVersion()

    // 3. 写入临时 CSV 文件供 Worker 读取
    const archiveDir = path.join(
      path.dirname(require.resolve('../services/XGBoostPredictionService')),
      '..', '..', '..', 'resources', 'models', 'archive', modelVersion
    )
    fs.mkdirSync(archiveDir, { recursive: true })
    const csvPath = path.join(archiveDir, 'training_data.csv')
    fs.writeFileSync(csvPath, dataResult.csv, 'utf-8')

    // 4. Worker Thread 训练（不传 outputDir，从内存返回模型数据）
    const nTrials = options?.nTrials ?? 50
    const trainResult = await XGBoostTrainingService.trainWithWorker(
      { csvPath, nTrials },
      (progress) => {
        // 向渲染进程发送训练进度
        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send('training:progress', progress)
        }
      }
    )

    // 5. 保存模型
    const targets = ['strength_28d', 'density', 'superplasticizer_dosage']
    const savedTargets = []
    if (trainResult.models) {
      for (const target of targets) {
        if (trainResult.models[target]) {
          await ModelVersionManager.saveModel(target, trainResult.models[target])
          savedTargets.push(target)
        }
      }
    }

    // 清空预测缓存，下次预测自动重新加载新模型
    XGBoostPredictionService.clearCache()

    // 6. 标记 TrialTestRecord（仅标记尚未标记过的记录，表示这批记录参与了训练）
    try {
      const { TrialTestRecord } = require('../db/models/TrialTestRecord')
      await TrialTestRecord.update(
        { trainedModelVersion: modelVersion },
        { where: { trainedModelVersion: null } }
      )
    } catch (dbErr) {
      console.warn('[TrainingHandler] 标记试配记录失败:', dbErr.message)
    }

    return {
      success: true,
      results: trainResult,
      modelVersion,
      savedTargets
    }
  } catch (error) {
    console.error('[TrainingHandler] 训练失败:', error)
    return {
      success: false,
      error: `训练失败: ${error.message}`
    }
  } finally {
    isTraining = false
  }
}

/**
 * 查询训练状态
 */
async function handleGetStatus() {
  return { isTraining }
}

/**
 * 回滚模型到上一个版本
 */
async function handleRollback(event, { target }) {
  try {
    await ModelVersionManager.rollback(target)
    XGBoostPredictionService.clearCache()
    return { success: true, target }
  } catch (error) {
    console.error('[TrainingHandler] 回滚失败:', error)
    return { success: false, error: error.message }
  }
}

// ============ 注册 ============

function registerHandlers(ipcMain) {
  ipcMain.handle('training:run', handleTrainingRun)
  ipcMain.handle('training:getStatus', handleGetStatus)
  ipcMain.handle('training:rollback', handleRollback)
  console.log('Training IPC handlers registered')
}

module.exports = {
  registerHandlers,
  handleTrainingRun,
  handleGetStatus,
  handleRollback
}
