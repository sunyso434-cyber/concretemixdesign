const XGBoostPredictionService = require('../services/XGBoostPredictionService')

const predictPerformance = async (event, params) => {
  try {
    const result = await XGBoostPredictionService.predict(params)
    return result
  } catch (error) {
    console.error('[XGBoostPrediction] IPC处理失败:', error)
    return {
      success: false,
      error: `预测请求处理失败: ${error.message}`
    }
  }
}

const registerHandlers = (ipcMain) => {
  ipcMain.handle('xgboost:predict', predictPerformance)
  console.log('XGBoost Prediction IPC handlers registered')
}

module.exports = { registerHandlers, predictPerformance }