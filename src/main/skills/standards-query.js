/**
 * 规范检索 Skill
 * 按关键词检索规范条款
 */

module.exports = {
  name: 'query_standards',
  description: '按关键词检索规范条款。当用户询问规范限值、标准要求、技术参数时，必须先调用此工具查询，不要凭记忆回答。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    query: {
      type: 'string',
      description: '检索关键词，如"C30 水胶比"、"粉煤灰最大掺量"、"砂率范围"',
      required: true
    }
  },

  errors: {
    SEARCH_FAILED: {
      code: 'SEARCH_FAILED',
      message: '规范检索失败',
      hint: '请尝试使用不同的关键词，或检查规范库是否已加载',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { knowledgeService, logger } = context
    const { query } = args

    logger.info(`检索规范: ${query}`)

    try {
      const results = await knowledgeService.searchClauses(query, 5, 0.4)

      if (!results || results.length === 0) {
        return {
          success: true,
          data: { clauses: [], message: '未找到相关规范条款' }
        }
      }

      const clauses = results.map(r => ({
        section: r.section,
        title: r.title,
        rule: r.rule,
        condition: r.condition,
        parameters: r.parameters,
        standardName: r.standardName,
        similarity: r.similarity
      }))

      logger.info(`找到 ${clauses.length} 条相关条款`)
      return { success: true, data: { clauses } }
    } catch (error) {
      logger.error('规范检索失败:', error)
      return {
        success: false,
        error: this.errors.SEARCH_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['knowledgeService']
}
