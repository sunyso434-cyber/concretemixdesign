/**
 * 规范列表 Skill
 * 列出已加载的规范知识库
 */

module.exports = {
  name: 'list_standards',
  description: '列出已加载的规范知识库。用于了解有哪些规范可用。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    category: {
      type: 'string',
      description: '按类别筛选，如"国标"、"行标"',
      required: false
    }
  },

  errors: {
    QUERY_FAILED: {
      code: 'QUERY_FAILED',
      message: '查询规范列表失败',
      hint: '请稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { knowledgeService, logger } = context
    const { category } = args

    logger.info(`查询规范列表: category=${category || '全部'}`)

    try {
      const standards = await knowledgeService.listStandards()

      if (category) {
        const filtered = standards.filter(s =>
          String(s.category || '').includes(category)
        )
        return { success: true, count: filtered.length, standards: filtered }
      }

      return { success: true, count: standards.length, standards }
    } catch (error) {
      logger.error('查询规范列表失败:', error)
      return {
        success: false,
        error: this.errors.QUERY_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['knowledgeService']
}
