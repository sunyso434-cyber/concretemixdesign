/**
 * 查询单个配合比方案 Skill
 */

module.exports = {
  name: 'get_mix_design',
  description: '查询单个配合比方案完整详情。需要看方案详情、分析方案时调用。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    id: { type: 'integer', required: true, description: '方案 ID' }
  },

  errors: {
    MISSING_ID: { code: 'MISSING_ID', message: '请指定方案ID', recovery: 'none' },
    NOT_FOUND: { code: 'NOT_FOUND', message: '方案不存在', recovery: 'none' },
    QUERY_FAILED: { code: 'QUERY_FAILED', message: '查询失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { mixDesignService, logger } = context
    const { id } = args
    if (!id) return { success: false, error: this.errors.MISSING_ID }
    try {
      const r = await mixDesignService.getMixDesignById(id)
      if (!r) return { success: false, error: this.errors.NOT_FOUND, details: { id } }
      const d = r.toJSON ? r.toJSON() : r
      return { success: true, data: d }
    } catch (e) {
      logger.error('get_mix_design 失败:', e)
      return { success: false, error: this.errors.QUERY_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['mixDesignService']
}
