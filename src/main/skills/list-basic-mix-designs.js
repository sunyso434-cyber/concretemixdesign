/**
 * 列出基准配合比方案 Skill
 * 支持按强度等级/混凝土类型/是否默认过滤 + 分页 + 排序（SPEC 4.1.1）
 */

module.exports = {
  name: 'list_basic_mix_designs',
  description: '列出基准配合比方案。支持按强度等级/混凝土类型/是否默认过滤，按时间或名称排序，分页。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    strengthGrade: { type: 'string', required: false, description: '按强度等级过滤，如 C30' },
    concreteType: { type: 'string', required: false, description: '按混凝土类型过滤，如 普通' },
    onlyDefault: { type: 'boolean', required: false, description: '只返回默认方案' },
    sortBy: { type: 'string', required: false, enum: ['updatedAt', 'createdAt', 'name'], default: 'updatedAt' },
    sortOrder: { type: 'string', required: false, enum: ['asc', 'desc'], default: 'desc' },
    limit: { type: 'integer', required: false, min: 1, max: 50, default: 10 },
    offset: { type: 'integer', required: false, min: 0, default: 0 }
  },

  errors: {
    QUERY_FAILED: { code: 'QUERY_FAILED', message: '查询失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { basicMixDesignService, logger } = context
    const {
      strengthGrade, concreteType, onlyDefault,
      sortBy = 'updatedAt', sortOrder = 'desc',
      limit, offset
    } = args
    const actualLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 50)
    const actualOffset = Math.max(parseInt(offset) || 0, 0)

    try {
      const filters = {}
      if (strengthGrade) filters.strengthGrade = strengthGrade
      if (concreteType) filters.concreteType = concreteType
      let rows = await basicMixDesignService.listBasicMixDesigns(filters)
      if (onlyDefault) rows = rows.filter(r => r.isDefault)
      // 排序
      rows.sort((a, b) => {
        const va = a[sortBy]
        const vb = b[sortBy]
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        if (va === vb) return 0
        const cmp = va > vb ? 1 : -1
        return sortOrder === 'asc' ? cmp : -cmp
      })
      const total = rows.length
      const paged = rows.slice(actualOffset, actualOffset + actualLimit).map(r => ({
        id: r.id, name: r.name, strengthGrade: r.strengthGrade,
        concreteType: r.concreteType, slump: r.slump,
        isDefault: r.isDefault, source: r.source
      }))
      return {
        success: true,
        data: { items: paged, total, limit: actualLimit, offset: actualOffset }
      }
    } catch (e) {
      logger.error('list_basic_mix_designs 失败:', e)
      return { success: false, error: this.errors.QUERY_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['basicMixDesignService']
}
