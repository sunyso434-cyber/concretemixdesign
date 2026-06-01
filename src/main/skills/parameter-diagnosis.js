/**
 * 参数诊断 Skill
 * 对上传的配合比数据执行参数诊断
 */

module.exports = {
  name: 'run_parameter_diagnosis',
  description: '对上传的配合比数据执行参数诊断，分析数据趋势和异常。',
  version: '1.0.0',
  category: 'analysis',

  parameters: {},

  errors: {
    NO_DATA: {
      code: 'PARAM_MISSING',
      message: '没有配合比数据可供诊断',
      hint: '请先在智能解析中上传数据',
      recovery: 'upload_data'
    },
    DIAGNOSIS_FAILED: {
      code: 'CALCULATION_FAILED',
      message: '参数诊断失败',
      hint: '请检查数据格式是否正确',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context

    logger.info('开始参数诊断')

    try {
      const { executeToolCall } = require('../ipcHandlers/aiAnalysisHandler')
      const result = await executeToolCall('run_parameter_diagnosis', args)
      return result
    } catch (error) {
      logger.error('参数诊断失败:', error)
      return {
        success: false,
        error: this.errors.DIAGNOSIS_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}
