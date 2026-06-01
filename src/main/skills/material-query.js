/**
 * 材料查询 Skill
 * 查询材料库中可用的原材料列表
 */

module.exports = {
  name: 'list_available_materials',
  description: '查询材料库中可用的原材料列表。用于了解有哪些材料可选，帮助用户做材料选择。同时基于材料属性做定性对比分析。',
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
    const { materialService, logger } = context
    const { type } = args

    logger.info(`查询材料库: type=${type || '全部'}`)

    try {
      const materials = await materialService.getAllMaterials()

      if (type) {
        const filtered = materials.filter(m => m.type === type)
        logger.info(`查询到 ${filtered.length} 个 ${type} 材料`)
        return { success: true, count: filtered.length, materials: filtered }
      }

      logger.info(`查询到 ${materials.length} 个材料`)
      return { success: true, count: materials.length, materials }
    } catch (error) {
      logger.error('查询材料库失败:', error)
      return {
        success: false,
        error: this.errors.QUERY_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}
