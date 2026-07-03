/**
 * 销售报价 Skill
 * 生成混凝土销售报价
 */

module.exports = {
  name: 'calculate_sales_quote',
  description: '基于**指定基准配合比 ID**（必填）+ 定价参数（可选），生成正式销售报价，返回含税单价/总价/利润/泵送费明细。**必须先有基准方案**——没有就先调 save_to_basic_mix_library。**与 prepare_quote_draft 的区别**：本工具基于已有基准 + 定价算**实际金额**；draft 工具按强度返回**报价模板**（不需基准）。当用户说"按基准 XX 算下报价""这个基准多少钱/m³"时调用。',
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
    const MaterialService = require('../services/MaterialService')
    const { basicMixId, pricing } = args

    logger.info(`生成销售报价: basicMixId=${basicMixId}`)

    try {
      // 查找基准配合比
      const basicMix = await basicMixDesignService.findById(basicMixId)
      if (!basicMix) {
        return { success: false, error: this.errors.MIX_NOT_FOUND, details: { basicMixId } }
      }

      // 补充材料单价（基准配合比存储时可能不含 price，需从材料库查询）
      const basicMixData = basicMix.toJSON()
      if (basicMixData.materials && Array.isArray(basicMixData.materials)) {
        const allMaterials = await MaterialService.getAllMaterials()
        const materialMap = new Map(allMaterials.map(m => [m.id, m]))
        const nameToMaterial = new Map()
        allMaterials.forEach(m => {
          nameToMaterial.set(m.name, m)
          if (m.type) nameToMaterial.set(`${m.type}_${m.name}`, m)
        })
        basicMixData.materials = basicMixData.materials.map(mat => {
          if (mat.price != null) return mat
          if (mat.materialId && materialMap.has(mat.materialId)) {
            const fullMat = materialMap.get(mat.materialId)
            return { ...mat, price: fullMat.price }
          }
          const matched = nameToMaterial.get(mat.materialName) ||
                          nameToMaterial.get(`${mat.materialType}_${mat.materialName}`)
          if (matched) {
            return { ...mat, materialId: matched.id, price: matched.price }
          }
          return mat
        })
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
        basicMix: basicMixData,
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
  },

  services: ['basicMixDesignService', 'salesQuoteCalculation']
}
