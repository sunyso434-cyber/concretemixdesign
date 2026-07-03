/**
 * 报价草稿 Skill
 * 根据强度等级返回销售报价草稿
 */

module.exports = {
  name: 'prepare_sales_quote_draft',
  description: '按强度等级（必填）+ 混凝土类型 + 坍落度返回**报价草稿模板**（默认单价/利润/泵送费占位）。**不需要基准配合比 ID**——快速出模板让用户填。**与 calculate_sales_quote 的区别**：本工具出模板（无金额）；sales_quote 算实际金额（必须传 basicMixId）。当用户说"给我个 C30 报价模板"用本工具；"按基准算报价金额"用 sales_quote。',
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
