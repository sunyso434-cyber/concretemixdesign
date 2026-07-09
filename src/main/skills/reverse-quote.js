/**
 * 反向套价 Skill（普通混凝土）
 * 按目标市价反推，让报价表看上去利润落在 profitSafeRange 区间
 * 利润区间默认 [0.5%, 3%]，但允许用户通过 agent 动态调整
 */

const MaterialService = require('../services/MaterialService')

module.exports = {
  name: 'reverse_sales_quote',
  description: '基于正式方案 ID（mixDesignId）或直接传的配合比材料数据（materials）+ 目标市价，生成普通混凝土报价（让报价表看上去利润落在 0.5%-3% 区间，**区间可由用户通过 agent 动态调整**）。利润偏离时自动按"材料单价包装"（默认）/ "制造费包装" / "人工费包装"等策略藏利润。**与 forward_sales_quote 的区别**：本工具反向套市价，要求传 targetUnitPrice；forward 工具正向测算。当用户说"按市场价 X 算报价"时调用本工具。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    mixDesignId: { type: 'integer', required: false, description: '正式方案 ID（与 materials 二选一）' },
    materials: { type: 'array', required: false, description: '配合比材料明细 [{materialId, materialName, materialType, usage, price?}]' },
    targetUnitPrice: { type: 'number', required: true, description: '目标市价（含税元/m³）' },
    strengthGrade: { type: 'string', required: false, description: '强度等级（覆盖 mixDesign 中 strength 字段）' },
    concreteType: { type: 'string', required: false, description: '混凝土类型' },
    slump: { type: 'number', required: false, description: '坍落度 mm' },
    fixedFees: { type: 'object', required: false, description: '固定费用明细 {manufacturingFee, laborFee, technicalServiceFee, salesFee, financeFee, transportDistance, transportUnitPrice, pumpingFee, equipmentFee}' },
    polishStrategy: { type: 'string', required: false, description: '包装策略：none / material_price（默认）/ manufacturing / labor' },
    profitSafeRange: { type: 'array', required: false, description: '安全利润率区间 [min, max]，默认 [0.005, 0.03]，用户可调' },
    vatRate: { type: 'number', required: false, description: '增值税率，默认 0.13' },
    priceOverrides: { type: 'object', required: false, description: '材料单价覆盖 {materialId: price}' }
  },

  errors: {
    MISSING_INPUT: { code: 'MISSING_INPUT', message: '缺少 mixDesignId 或 materials', hint: '传 mixDesignId 让 agent 查配合比，或直接传 materials', recovery: 'retry' },
    MIX_NOT_FOUND: { code: 'MATERIAL_NOT_FOUND', message: '正式方案不存在', hint: '检查 mixDesignId 是否正确', recovery: 'none' },
    MATERIAL_INVALID: { code: 'MATERIAL_NOT_FOUND', message: '材料缺失或无单价', hint: '检查配合比材料是否已维护价格', recovery: 'retry' },
    QUOTE_FAILED: { code: 'QUOTE_GENERATION_FAILED', message: '反向套价失败', hint: '检查目标市价/配合比数据/费率参数', recovery: 'retry' }
  },

  async execute(args, context) {
    const { mixDesignService, salesQuoteCalculation, logger } = context
    const { mixDesignId, materials: inputMaterials, targetUnitPrice, polishStrategy, profitSafeRange, vatRate, fixedFees, strengthGrade, concreteType, slump, priceOverrides } = args

    logger.info(`[reverse_sales_quote] 启动 mixDesignId=${mixDesignId} targetUnitPrice=${targetUnitPrice}`)

    try {
      if (!mixDesignId && (!Array.isArray(inputMaterials) || inputMaterials.length === 0)) {
        return { success: false, error: this.errors.MISSING_INPUT, details: { mixDesignId, materialsLength: inputMaterials?.length || 0 } }
      }

      // 步骤 1: 解析 materials (从 mixDesignId 拉 或 用入参)
      let materials = inputMaterials
      let resolvedStrengthGrade = strengthGrade
      let resolvedConcreteType = concreteType
      let resolvedSlump = slump

      if (mixDesignId) {
        const mixDesign = await mixDesignService.getMixDesignById(mixDesignId)
        if (!mixDesign) {
          return { success: false, error: this.errors.MIX_NOT_FOUND, details: { mixDesignId } }
        }
        const mixJson = mixDesign.toJSON ? mixDesign.toJSON() : mixDesign
        materials = Array.isArray(mixJson.materials) ? mixJson.materials : []
        if (!resolvedStrengthGrade) resolvedStrengthGrade = mixJson.strength || mixJson.strengthGrade
        if (!resolvedConcreteType) resolvedConcreteType = mixJson.concreteType
        if (resolvedSlump == null) resolvedSlump = mixJson.slump
      }

      if (!Array.isArray(materials) || materials.length === 0) {
        return { success: false, error: this.errors.MATERIAL_INVALID, details: { reason: 'materials 数组为空' } }
      }

      // 步骤 2: 补材料单价(沿用老 skill 逻辑)
      const needPriceLookup = materials.some(m => m.price == null)
      if (needPriceLookup) {
        const allMaterials = await MaterialService.getAllMaterials()
        const materialMap = new Map(allMaterials.map(m => [m.id, m]))
        const nameToMaterial = new Map()
        allMaterials.forEach(m => {
          nameToMaterial.set(m.name, m)
          if (m.type) nameToMaterial.set(`${m.type}_${m.name}`, m)
        })
        materials = materials.map(m => {
          if (m.price != null) return m
          if (m.materialId && materialMap.has(m.materialId)) {
            const fullMat = materialMap.get(m.materialId)
            return { ...m, price: fullMat.price, materialType: m.materialType || fullMat.type }
          }
          const matched = nameToMaterial.get(m.materialName) ||
                          nameToMaterial.get(`${m.materialType}_${m.materialName}`)
          if (matched) {
            return { ...m, materialId: matched.id, price: matched.price, materialType: m.materialType || matched.type }
          }
          return m
        })
      }

      // 步骤 3: 调算法
      const result = salesQuoteCalculation.calculateReverse({
        materials,
        targetUnitPrice: Number(targetUnitPrice),
        polishStrategy,
        profitSafeRange,
        vatRate,
        fixedFees,
        priceOverrides,
        strengthGrade: resolvedStrengthGrade,
        concreteType: resolvedConcreteType,
        slump: resolvedSlump
      })

      logger.info(`[reverse_sales_quote] 完成 suggestedDealPrice=${result.suggestedDealPrice} actualProfitRate=${(result.actualProfitRate * 100).toFixed(2)}% polished=${result.polished}`)

      return {
        success: true,
        type: 'sales_quote',
        mode: 'reverse',
        data: result,
        suggestions: result.polished
          ? ['已用包装策略让利润率落进安全区间，查看 polishedUnitPrices 了解包装细节', '是否需要保存到历史？', '是否需要导出报告？']
          : ['利润已在安全区间内，未包装', '是否需要保存到历史？', '是否需要导出报告？']
      }
    } catch (error) {
      logger.error('[reverse_sales_quote] 失败:', error)
      return {
        success: false,
        error: this.errors.QUOTE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['mixDesignService', 'salesQuoteCalculation']
}
