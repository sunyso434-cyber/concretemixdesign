/**
 * 销售报价 Skill
 * 生成混凝土销售报价
 */

module.exports = {
  name: 'calculate_sales_quote',
  description: '生成混凝土销售报价。当用户要求生成报价时调用。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    basicMixId: {
      type: 'integer',
      description: '基准配合比ID',
      required: true
    },
    pricing: {
      type: 'object',
      description: '定价参数，包含 profitRate、vatRate、manufacturingFee、transportDistance 等',
      required: false
    }
  },

  errors: {
    MIX_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '基准配合比不存在',
      hint: '请先保存配合比到基准配合比库，或检查配合比ID是否正确',
      recovery: 'save_basic_mix'
    },
    QUOTE_FAILED: {
      code: 'QUOTE_GENERATION_FAILED',
      message: '生成报价失败',
      hint: '请检查配合比数据和定价参数是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { basicMixDesignService, salesQuoteCalculation, logger } = context
    const { basicMixId, pricing } = args

    logger.info(`生成销售报价: basicMixId=${basicMixId}`)

    try {
      // 查找基准配合比
      const basicMix = await basicMixDesignService.findById(basicMixId)
      if (!basicMix) {
        return { success: false, error: this.errors.MIX_NOT_FOUND, details: { basicMixId } }
      }

      // 默认定价参数
      const defaultPricing = {
        profitRate: 0.12,
        vatRate: 0.13,
        manufacturingFee: 18,
        technicalServiceFee: 0,
        transportDistance: 20,
        transportUnitPrice: 2.5,
        quoteRangeDelta: 5
      }

      const mergedPricing = { ...defaultPricing, ...pricing }

      // 计算报价
      const result = salesQuoteCalculation.calculate({
        basicMix: basicMix.toJSON(),
        pricing: mergedPricing
      })

      logger.info(`报价生成完成: 含税价=${result.suggestedDealPrice}元/m³`)

      return {
        success: true,
        type: 'sales_quote',
        data: result,
        suggestions: ['是否需要保存报价方案？', '是否需要导出Excel？']
      }
    } catch (error) {
      logger.error('生成报价失败:', error)
      return {
        success: false,
        error: this.errors.QUOTE_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}
