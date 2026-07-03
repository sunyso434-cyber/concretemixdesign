/**
 * 参数诊断 Skill
 * 对上传的配合比数据执行参数诊断
 */

module.exports = {
  name: 'run_parameter_diagnosis',
  description: '对**已上传到智能解析模块**的配合比数据做多维度诊断（水胶比/砂率/容重是否在规范范围、粉煤灰掺量是否超限、成本/强度性价比）。**不接收参数**——数据从 context.sessionData 读。当用户说"分析这套数据""诊断刚才上传的配合比"时调用，**前提是用户已经在智能解析模块上传过数据**。**不输出新配合比**——只给诊断报告；想重新设计请用 calculate_mix_design。',
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
  },

  services: ['materialService']
}
