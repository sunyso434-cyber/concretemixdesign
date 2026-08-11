/**
 * 剩余供应滚动优化 Skill（场景B · 事中）
 * 根据已导入每车明细，滚动优化剩余未完成供应。输出:
 *   - 施工节奏推算（公式: pace = (累计方量 - 首车方量) / 总间隔时间）
 *   - 发料时间修正建议
 *   - 剩余风险
 * 供应过程中导入车次后调用。无车次数据时返回 E-EVAL-002 错误。
 * 返回结构化数据，由 agent 翻译成自然语言给用户。
 */

module.exports = {
  name: 'optimize_remaining_supply',
  category: 'analysis',
  description: '根据已导入每车明细，滚动优化剩余未完成供应(场景B，事中)。输出：施工节奏推算(公式：pace=(累计方量-首车方量)/总间隔时间)、发料时间修正建议、剩余风险。供应过程中导入车次后调用。无车次数据时返回E-EVAL-002错误。返回结构化数据，由agent翻译成自然语言给用户。',
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      branchId: { type: 'integer' }
    },
    required: ['date']
  },

  async execute(args, context) {
    const { remainingSupplyOptimizer, logger } = context
    const { date, branchId } = args

    try {
      logger.info(`滚动优化剩余供应: date=${date} branchId=${branchId || 'all'}`)
      const result = await remainingSupplyOptimizer.optimize(date, branchId)
      return { success: true, data: result }
    } catch (error) {
      logger.error(`滚动优化失败: ${error.message}`)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['remainingSupplyOptimizer']
}
