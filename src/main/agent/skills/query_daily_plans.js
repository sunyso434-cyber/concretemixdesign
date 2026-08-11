// src/main/agent/skills/query_daily_plans.js
const DailyPlanService = require('../../services/DailyPlanService')

module.exports = {
  name: 'query_daily_plans',
  category: 'query',
  description: '查询每日计划(含每车明细聚合、执行进度)。不传date查最近7天。withVehicles默认true返回车次聚合。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD，不传查最近7天' },
      branchId: { type: 'integer' },
      withVehicles: { type: 'boolean', default: true }
    }
  },
  isWrite: false,
  async handler({ date, branchId, withVehicles = true }) {
    if (date) {
      if (withVehicles) {
        return await DailyPlanService.listWithVehicleDetails(date, branchId)
      }
      return await DailyPlanService.listByDate(date, branchId)
    }
    // 查最近7天
    const today = new Date()
    const results = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const plans = withVehicles
        ? await DailyPlanService.listWithVehicleDetails(dateStr, branchId)
        : await DailyPlanService.listByDate(dateStr, branchId)
      results.push(...plans)
    }
    return results
  }
}
