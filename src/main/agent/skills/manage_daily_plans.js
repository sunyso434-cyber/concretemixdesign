// src/main/agent/skills/manage_daily_plans.js
const DailyPlanService = require('../../services/DailyPlanService')

module.exports = {
  name: 'manage_daily_plans',
  category: 'manage',
  description: '管理每日生产调度计划(CRUD)。action: create|update|delete|get。同一天同工程同部位同标号同站只能一条。匹配键字段(planDate/projectName/pourLocation/strengthGrade/branchId)不可修改。boundMixDesignId必填。有车次时不可删除(用forceDelete=true强制删，会置车次planId=NULL)。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'get'] },
      id: { type: 'integer' },
      data: { type: 'object', description: 'create/update时必填，含planDate/projectName/pourLocation/strengthGrade/branchId/volume/plannedSendTime/expectedDuration/boundMixDesignId等' },
      forceDelete: { type: 'boolean', description: '删除时有车次是否强制删除，默认false' }
    },
    required: ['action']
  },
  isWrite: true,
  async handler({ action, id, data, forceDelete }) {
    switch (action) {
      case 'get': return await DailyPlanService.getById(id)
      case 'create': return await DailyPlanService.create(data)
      case 'update': return await DailyPlanService.update(id, data)
      case 'delete': return await DailyPlanService.delete(id, forceDelete)
      default: throw new Error(`未知action: ${action}`)
    }
  }
}
