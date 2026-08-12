/**
 * 每日计划查询 Skill
 * 查询每日计划(含每车明细聚合、执行进度)
 */

module.exports = {
  name: 'query_daily_plans',
  category: 'query',
  description: '查询每日计划(含每车明细聚合、执行进度)。不传date查最近7天。withVehicles默认true返回车次聚合。',
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD，不传查最近7天' },
      branchId: { type: 'integer' },
      withVehicles: { type: 'boolean', default: true }
    }
  },

  async execute(args, context) {
    const { dailyPlanService, logger } = context
    const { date, branchId, withVehicles = true } = args

    try {
      let result
      if (date) {
        result = withVehicles
          ? await dailyPlanService.listWithVehicleDetails(date, branchId)
          : await dailyPlanService.listByDate(date, branchId)
      } else {
        // 查最近7天
        const today = new Date()
        const all = []
        for (let i = 0; i < 7; i++) {
          const d = new Date(today)
          d.setDate(d.getDate() - i)
          const dateStr = d.toISOString().slice(0, 10)
          const plans = withVehicles
            ? await dailyPlanService.listWithVehicleDetails(dateStr, branchId)
            : await dailyPlanService.listByDate(dateStr, branchId)
          all.push(...(plans || []))
        }
        result = all
      }
      logger.info(`每日计划查询成功: ${Array.isArray(result) ? result.length : 1} 条`)
      return { success: true, data: result }
    } catch (error) {
      logger.error('每日计划查询失败:', error.message)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['dailyPlanService']
}