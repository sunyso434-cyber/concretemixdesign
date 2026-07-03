/**
 * 列出配合比方案 Skill
 * 支持按状态/强度/关键词过滤、按时间或名称排序、分页（SPEC 4.1.1）
 */

module.exports = {
  name: 'list_mix_designs',
  description: '列出配合比方案（正式/草稿）。支持按状态/强度/关键词过滤，按时间或名称排序，分页（默认返回前 10 条，可传 limit/offset 翻页）。当用户问"有哪些方案""查 C30 草稿"时调用。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    status: { type: 'string', required: false, enum: ['草稿', '已确认', '已验证', '已使用'] },
    strength: { type: 'string', required: false, description: '按强度等级过滤，如 C30' },
    keyword: { type: 'string', required: false, description: '模糊匹配 name/projectName/description' },
    sortBy: { type: 'string', required: false, enum: ['updatedAt', 'createdAt', 'name'], default: 'updatedAt' },
    sortOrder: { type: 'string', required: false, enum: ['asc', 'desc'], default: 'desc' },
    limit: { type: 'integer', required: false, min: 1, max: 50, default: 10 },
    offset: { type: 'integer', required: false, min: 0, default: 0 }
  },

  errors: {
    QUERY_FAILED: { code: 'QUERY_FAILED', message: '查询失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { mixDesignService, logger } = context
    const {
      status, strength, keyword,
      sortBy = 'updatedAt', sortOrder = 'desc',
      limit, offset
    } = args
    const actualLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 50)
    const actualOffset = Math.max(parseInt(offset) || 0, 0)

    try {
      const all = await mixDesignService.getAllMixDesigns({})
      // 1. 过滤
      let records = all.filter(r => {
        if (status && r.status !== status) return false
        if (strength && !String(r.strength || '').includes(strength)) return false
        if (keyword) {
          const k = keyword.toLowerCase()
          const hay = `${r.name || ''} ${r.projectName || ''} ${r.description || ''}`.toLowerCase()
          if (!hay.includes(k)) return false
        }
        return true
      })
      // 2. 排序
      records.sort((a, b) => {
        const va = a[sortBy]
        const vb = b[sortBy]
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        if (va === vb) return 0
        const cmp = va > vb ? 1 : -1
        return sortOrder === 'asc' ? cmp : -cmp
      })
      // 3. 分页
      const total = records.length
      const paged = records.slice(actualOffset, actualOffset + actualLimit).map(r => ({
        id: r.id, name: r.name, strength: r.strength, slump: r.slump,
        status: r.status, totalCost: r.totalCost, createdAt: r.createdAt
      }))
      return {
        success: true,
        data: { items: paged, total, limit: actualLimit, offset: actualOffset }
      }
    } catch (e) {
      logger.error('list_mix_designs 失败:', e)
      return { success: false, error: this.errors.QUERY_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['mixDesignService']
}
