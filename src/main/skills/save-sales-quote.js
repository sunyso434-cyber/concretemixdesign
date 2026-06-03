/**
 * 保存销售报价 Skill
 * 保存销售报价方案到历史记录
 */

module.exports = {
  name: 'save_sales_quote',
  description: '保存销售报价方案到历史记录。当用户要求保存报价时调用。',
  version: '1.0.0',
  category: 'save',
  requiresConfirmation: true,

  parameters: {
    strengthGrade: {
      type: 'string',
      description: '强度等级，如 C30',
      required: false
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
    },
    basicMixId: {
      type: 'integer',
      description: '基准配合比ID（可选）',
      required: false
    },
    basicMixName: {
      type: 'string',
      description: '基准配合比名称（可选）',
      required: false
    },
    pricingParams: {
      type: 'object',
      description: '定价参数（可选）',
      required: false
    },
    resultSnapshot: {
      type: 'object',
      description: '报价结果快照（可选）',
      required: false
    },
    remarks: {
      type: 'string',
      description: '备注（可选）',
      required: false
    }
  },

  errors: {
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存报价失败',
      hint: '请检查报价数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { salesQuoteHistory, logger } = context

    logger.info('保存销售报价')

    try {
      const saved = await salesQuoteHistory.saveQuote(args)
      return {
        success: true,
        type: 'save_result',
        message: `报价方案已保存，ID: ${saved.id}`,
        data: saved
      }
    } catch (error) {
      logger.error('保存报价失败:', error)
      return {
        success: false,
        error: this.errors.SAVE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['salesQuoteHistory']
}
