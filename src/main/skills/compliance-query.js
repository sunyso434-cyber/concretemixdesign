/**
 * 合规校验 Skill
 * 对配合比方案做规范合规校验
 */

module.exports = {
  name: 'query_compliance_check',
  description: '对配合比方案做规范合规校验。当用户想检查方案是否符合规范、或设计完成后主动建议校验时调用。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    mixDesign: {
      type: 'object',
      description: '配合比方案对象，包含 waterBinderRatio（水胶比）、cementContent（水泥用量）、sandRatio（砂率）等字段',
      required: true
    }
  },

  errors: {
    INVALID_INPUT: {
      code: 'PARAM_INVALID_FORMAT',
      message: '配合比方案格式无效',
      hint: '请提供有效的配合比方案对象',
      recovery: 'fix_params'
    },
    CHECK_FAILED: {
      code: 'COMPLIANCE_CHECK_FAILED',
      message: '合规校验失败',
      hint: '请检查配合比数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { mixDesign } = args

    if (!mixDesign || typeof mixDesign !== 'object') {
      return { success: false, error: this.errors.INVALID_INPUT }
    }

    logger.info('开始合规校验')

    try {
      const { executeToolCall } = require('../ipcHandlers/aiAnalysisHandler')
      const result = await executeToolCall('query_compliance_check', args)
      return result
    } catch (error) {
      logger.error('合规校验失败:', error)
      return {
        success: false,
        error: this.errors.CHECK_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}
