/**
 * retrain-model.js
 * AI 技能：重新训练 XGBoost 预测模型（28d 强度 / 容重 / 减水剂掺量）
 *
 * 触发词：重新训练 / 训练模型 / 更新模型 / 用试配数据训练
 * 复用 TrainingRunner.runTraining —— 与设置页「模型管理」训练面板同一条训练管线（单一来源）
 *
 * 注：不用 MD/soft 格式——应用内 soft 触发机制未接线，MD 无法真正执行训练。
 */

const TrainingRunner = require('../services/training/TrainingRunner')

module.exports = {
  name: 'retrain_model',
  description:
    '重新训练 XGBoost 预测模型（28d 强度 / 容重 / 减水剂掺量），基于基座数据 + 试配记录，' +
    '训练前自动归档旧版本，完成后清缓存并返回 RMSE/R² 等指标。触发词：重新训练、训练模型、更新模型、用试配数据训练。',
  version: '1.0.0',
  category: 'training',
  parameters: {
    nTrials: {
      type: 'number',
      description: 'TPE 调参试验次数，默认 50，范围 1-200',
      required: false,
      min: 1,
      max: 200
    }
  },
  async execute(args, context, runtimeCtx) {
    const { logger } = context
    const nTrials = args?.nTrials

    logger.info(`[retrain_model] 开始训练 nTrials=${nTrials ?? '默认(50)'}`)

    // 进度转发到渲染进程（训练面板 / 聊天页监听的 training:progress 通道）
    const onProgress = (data) => {
      try {
        runtimeCtx?.webContents?.send('training:progress', data)
      } catch (e) {
        // 渲染进程已关闭，忽略
      }
    }

    const result = await TrainingRunner.runTraining({ nTrials }, onProgress)

    logger.info(
      `[retrain_model] 训练结果: success=${result.success}` +
      (result.error ? `, error=${result.error}` : '')
    )
    return result
  }
}
