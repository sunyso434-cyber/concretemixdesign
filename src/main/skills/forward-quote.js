/**
 * 正向议价测算 Skill（特殊混凝土）
 * 按成本+利润出三档议价区间（10% / 25% / 40%）
 * 设备摊销 = 采购价 ÷ 预计总方量
 */

const MaterialService = require('../services/MaterialService')

module.exports = {
  name: 'forward_sales_quote',
  description: '基于正式方案 ID（mixDesignId）或直接传的配合比材料数据（materials）+ 成本明细 + 可选设备摊销，生成特殊混凝土报价（输出 10% / 25% / 40% 三档含税议价区间）。设备摊销 = 采购价 ÷ 预计总方量。**与 reverse_sales_quote 的区别**：本工具正向测算，要求传完整成本（fixedFees）和可选设备摊销；reverse 反向套市价，必传 targetUnitPrice。当用户说"算特殊混凝土报价（含新设备分摊）"时调用本工具。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    mixDesignId: { type: 'integer', required: false, description: '正式方案 ID（与 materials 二选一）' },
    materials: { type: 'array', required: false, description: '配合比材料明细 [{materialId, materialName, materialType, usage, price?}]' },
    strengthGrade: { type: 'string', required: false, description: '强度等级（覆盖 mixDesign 中 strength 字段）' },
    concreteType: { type: 'string', required: false, description: '混凝土类型' },
    slump: { type: 'number', required: false, description: '坍落度 mm' },
    fixedFees: { type: 'object', required: false, description: '固定费用明细 {manufacturingFee, laborFee, technicalServiceFee, salesFee, financeFee, transportDistance, transportUnitPrice, pumpingFee}' },
    equipmentAmortization: { type: 'object', required: false, description: '设备摊销 {purchaseCost, totalAmortizeVolume, currentOrderVolume}' },
    profitRange: { type: 'array', required: false, description: '利润区间 [min, max]，默认 [0.10, 0.40]，中位自动算术平均' },
    vatRate: { type: 'number', required: false, description: '增值税率，默认 0.13' },
    priceOverrides: { type: 'object', required: false, description: '材料单价覆盖 {materialId: price}' }
  },

  errors: {
    MISSING_INPUT: { code: 'MISSING_INPUT', message: '缺少 mixDesignId 或 materials', hint: '传 mixDesignId 让 agent 查配合比，或直接传 materials', recovery: 'retry' },
    MIX_NOT_FOUND: { code: 'MATERIAL_NOT_FOUND', message: '正式方案不存在', hint: '检查 mixDesignId 是否正确', recovery: 'none' },
    MATERIAL_INVALID: { code: 'MATERIAL_NOT_FOUND', message: '材料缺失或无单价', hint: '检查配合比材料是否已维护价格', recovery: 'retry' },
    EQUIPMENT_INVALID: { code: 'EQUIPMENT_INVALID', message: '设备摊销参数无效', hint: 'totalAmortizeVolume 必须 > 0', recovery: 'retry' },
    QUOTE_FAILED: { code: 'QUOTE_GENERATION_FAILED', message: '正向测算失败', hint: '检查配合比数据/费率参数/设备摊销', recovery: 'retry' }
  },

  async execute(args, context) {
    const { mixDesignService, salesQuoteCalculation, logger } = context
    const { mixDesignId, materials: inputMaterials, fixedFees, equipmentAmortization, profitRange, vatRate, strengthGrade, concreteType, slump, priceOverrides } = args

    logger.info(`[forward_sales_quote] 启动 mixDesignId=${mixDesignId} profitRange=${JSON.stringify(profitRange || [0.10, 0.40])}`)

    try {
      if (!mixDesignId && (!Array.isArray(inputMaterials) || inputMaterials.length === 0)) {
        return { success: false, error: this.errors.MISSING_INPUT, details: { mixDesignId, materialsLength: inputMaterials?.length || 0 } }
      }

      // 步骤 1: 解析 materials
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

      // 步骤 2: 补材料单价
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

      // 步骤 3: 校验设备摊销
      if (equipmentAmortization) {
        if (Number(equipmentAmortization.totalAmortizeVolume) <= 0) {
          return { success: false, error: this.errors.EQUIPMENT_INVALID, details: { totalAmortizeVolume: equipmentAmortization.totalAmortizeVolume } }
        }
      }

      // 步骤 4: 调算法
      const result = salesQuoteCalculation.calculateForward({
        materials,
        fixedFees,
        equipmentAmortization,
        profitRange,
        vatRate,
        priceOverrides,
        strengthGrade: resolvedStrengthGrade,
        concreteType: resolvedConcreteType,
        slump: resolvedSlump
      })

      logger.info(`[forward_sales_quote] 完成 suggestedPrice=${result.suggestedPrice} range=[${result.minPrice}, ${result.maxPrice}]`)

      return {
        success: true,
        type: 'sales_quote',
        mode: 'forward',
        data: result,
        suggestions: [
          `三档议价区间已生成：最低 ${result.minPrice} 元/m³（10% 利润）、建议 ${result.suggestedPrice} 元/m³（${(result.profitRange.mid * 100).toFixed(1)}% 利润）、最高 ${result.maxPrice} 元/m³（40% 利润）`,
          '是否需要保存到历史？',
          '是否需要导出报告？'
        ]
      }
    } catch (error) {
      logger.error('[forward_sales_quote] 失败:', error)
      return {
        success: false,
        error: this.errors.QUOTE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['mixDesignService', 'salesQuoteCalculation']
}
