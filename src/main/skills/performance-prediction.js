/**
 * 性能预测 Skill
 * 基于XGBoost模型预测混凝土性能
 */

module.exports = {
  name: 'predict_performance',
  description: '基于XGBoost模型预测混凝土28天强度、坍落度、容重。用于评估配合比的预期性能。',
  version: '1.0.0',
  category: 'analysis',

  parameters: {
    cementId: {
      type: 'integer',
      description: '水泥材料ID',
      required: true
    },
    sandId: {
      type: 'integer',
      description: '细骨料材料ID',
      required: true
    },
    stoneId: {
      type: 'integer',
      description: '粗骨料材料ID',
      required: true
    }
  },

  errors: {
    PREDICTION_FAILED: {
      code: 'CALCULATION_FAILED',
      message: '性能预测失败',
      hint: '请检查材料ID是否正确，或模型是否已加载',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { xgboostPrediction, logger } = context

    logger.info('开始性能预测')

    try {
      const result = await xgboostPrediction.predict(args)
      logger.info(`性能预测完成: 强度=${result.strength28d}MPa`)
      return { success: true, type: 'prediction', data: result }
    } catch (error) {
      logger.error('性能预测失败:', error)
      return {
        success: false,
        error: this.errors.PREDICTION_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['xgboostPrediction']
}
