/**
 * 计划风险评估 Skill（场景A · 事前）
 * 评估已编排计划的合理性。输出四部分报告:
 *   1) 产能预警 — 按小时桶分摊方量，找峰值桶，判断是否超载
 *   2) 运输能力预警 — 车辆调度模拟器，计算延误分钟数
 *   3) 单方运输成本对比 — 只比运输成本（材料成本各站相同），缺距离记录跳过
 *   4) 综合建议 — 产能 > 运力 > 成本 优先级
 * 计划编排完后调用。评估只给建议，不自动改计划。
 * 返回结构化数据，由 agent 翻译成自然语言给用户。
 */

module.exports = {
  name: 'evaluate_plan_risks',
  category: 'analysis',
  description: '评估已编排计划的合理性(场景A，事前)。输出四部分报告：1)产能预警：按小时桶分摊方量，找峰值桶，判断是否超载；2)运输能力预警：车辆调度模拟器，计算延误分钟数；3)单方运输成本对比：只比运输成本(材料成本各站相同)，缺距离记录跳过；4)综合建议：产能>运力>成本 优先级。计划编排完后调用。评估只给建议，不自动改计划。返回结构化数据，由agent翻译成自然语言给用户。',
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD，评估哪天的计划' },
      branchId: { type: 'integer', description: '可选，限定某分公司' }
    },
    required: ['date']
  },

  async execute(args, context) {
    const { productionPlanEvaluator, logger } = context
    const { date, branchId } = args

    try {
      logger.info(`评估计划: date=${date} branchId=${branchId || 'all'}`)
      const result = await productionPlanEvaluator.evaluate(date, branchId)
      return { success: true, data: result }
    } catch (error) {
      logger.error(`评估失败: ${error.message}`)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['productionPlanEvaluator']
}
