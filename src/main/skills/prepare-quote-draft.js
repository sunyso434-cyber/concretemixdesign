/**
 * 报价草稿 Skill
 * 根据强度等级返回销售报价草稿
 */

module.exports = {
  name: 'prepare_sales_quote_draft',
  description: '根据强度等级返回销售报价草稿。用于快速生成报价模板。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    strengthGrade: {
      type: 'string',
      description: '强度等级，如 C30',
      required: true
    },
    concreteType: {
      type: 'string',
      description: '混凝土类型，如 普通',
      required: false
    },
    slump: {
      type: 'number',
      description: '坍落度(mm)',
      required: false
    }
  },

  errors: {
    QUERY_FAILED: {
      code: 'QUERY_FAILED',
      message: '生成报价草稿失败',
      hint: '请稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context

    logger.info(`生成报价草稿: ${args.strengthGrade}`)

    try {
      const { executeToolCall } = require('../ipcHandlers/aiAnalysisHandler')
      const result = await executeToolCall('prepare_sales_quote_draft', args)
      return result
    } catch (error) {
      logger.error('生成报价草稿失败:', error)
      return {
        success: false,
        error: this.errors.QUERY_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['salesQuoteCalculation']
}
