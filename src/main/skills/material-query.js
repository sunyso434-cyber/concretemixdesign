/**
 * 材料查询 Skill
 * 查询材料库中可用的原材料列表
 */

// 批次概要字段（list_available_materials 返回时附带，不含检测值，省 token；
// 需要检测值用 manage_material_batches 的 get 查详情）
const SUMMARY_FIELDS = [
  'id', 'batchNumber', 'supplier', 'quantity', 'status',
  'productionDate', 'receiptDate', 'expiryDate', 'testDate'
]

module.exports = {
  name: 'list_available_materials',
  description: '查询材料库中可用的原材料列表。仅在使用内置 calculate_mix_design 等工具时需要先调用。如果已有匹配的自定义技能（如 self_compacting_concrete_design），不要调用此工具——自定义技能内部会自行获取材料。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    type: {
      type: 'string',
      description: '材料类型筛选：水泥/细骨料/粗骨料/粉煤灰/矿渣粉/锂渣/复合粉/减水剂。不填返回全部。',
      required: false,
      enum: ['水泥', '细骨料', '粗骨料', '粉煤灰', '矿渣粉', '锂渣', '复合粉', '减水剂']
    }
  },

  errors: {
    QUERY_FAILED: {
      code: 'QUERY_FAILED',
      message: '查询材料库失败',
      hint: '请稍后重试，或检查数据库连接',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { materialService, materialBatchService, logger } = context
    const { type } = args

    logger.info(`查询材料库: type=${type || '全部'}`)

    try {
      const materials = await materialService.getAllMaterials()

      // 为每个材料附带批次概要（不含检测值，省 token；需要检测值用 manage_material_batches 的 get 查）
      const withBatches = await Promise.all(materials.map(async (m) => {
        let batches = []
        try {
          const all = await materialBatchService.getBatchesByMaterialId(m.id)
          batches = all.map(b => {
            const s = {}
            for (const k of SUMMARY_FIELDS) s[k] = b[k] !== undefined ? b[k] : null
            return s
          })
        } catch (e) {
          logger.warn(`查询材料 ${m.id} 批次失败: ${e.message}`)
        }
        return { ...m, batches }
      }))

      if (type) {
        const filtered = withBatches.filter(m => m.type === type)
        logger.info(`查询到 ${filtered.length} 个 ${type} 材料`)
        return { success: true, count: filtered.length, materials: filtered }
      }

      logger.info(`查询到 ${withBatches.length} 个材料`)
      return { success: true, count: withBatches.length, materials: withBatches }
    } catch (error) {
      logger.error('查询材料库失败:', error)
      return {
        success: false,
        error: this.errors.QUERY_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['materialService', 'materialBatchService']
}
