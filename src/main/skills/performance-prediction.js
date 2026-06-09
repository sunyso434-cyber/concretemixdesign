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
    cementAmount: { type: 'number', description: '水泥用量(kg/m³)', required: true },
    waterBinderRatio: { type: 'number', description: '水胶比', required: true },
    cementId: { type: 'integer', description: '水泥材料ID', required: true },
    sandId: { type: 'integer', description: '细骨料材料ID', required: true },
    stoneId: { type: 'integer', description: '粗骨料材料ID', required: true },
    flyAshDosage: { type: 'number', description: '粉煤灰掺量(%)' },
    slagDosage: { type: 'number', description: '矿渣粉掺量(%)' },
    lithiumSlagDosage: { type: 'number', description: '锂渣掺量(%)' },
    compositePowderDosage: { type: 'number', description: '复合粉掺量(%)' },
    sandRatio: { type: 'number', description: '砂率(%)' },
    superplasticizerDosage: { type: 'number', description: '减水剂掺量(%)' },
    flyAshId: { type: 'integer', description: '粉煤灰材料ID' },
    slagId: { type: 'integer', description: '矿渣粉材料ID' },
    lithiumSlagId: { type: 'integer', description: '锂渣材料ID' },
    compositePowderId: { type: 'integer', description: '复合粉材料ID' },
    superplasticizerId: { type: 'integer', description: '减水剂材料ID' },
    flyAshAmount: { type: 'number', description: '粉煤灰用量(kg/m³)' },
    slagAmount: { type: 'number', description: '矿渣粉用量(kg/m³)' },
    waterAmount: { type: 'number', description: '用水量(kg/m³)' },
    sandAmount: { type: 'number', description: '砂用量(kg/m³)' },
    stoneAmount: { type: 'number', description: '石用量(kg/m³)' },
    superplasticizerAmount: { type: 'number', description: '减水剂用量(kg/m³)' },
    temperature: { type: 'number', description: '养护温度(℃)' },
    humidity: { type: 'number', description: '养护湿度(%)' },
    curingAge: { type: 'number', description: '养护龄期(天)' }
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
