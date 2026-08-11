/**
 * 每日计划管理 Skill
 * 管理每日生产调度计划(CRUD)
 */

module.exports = {
  name: 'manage_daily_plans',
  category: 'manage',
  description: '管理每日生产调度计划(CRUD)。action: create|update|delete|get。同一天同工程同部位同标号同站只能一条。匹配键字段(planDate/projectName/pourLocation/strengthGrade/branchId)不可修改。boundMixDesignId必填。有车次时不可删除(用forceDelete=true强制删，会置车次planId=NULL)。',
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'get'] },
      id: { type: 'integer' },
      data: {
        type: 'object',
        description: 'create/update时必填。必须是JSON对象(不能是JSON字符串)，字段如下。必填: planDate,projectName,pourLocation,strengthGrade,branchId,volume,plannedSendTime,expectedDuration,boundMixDesignId',
        properties: {
          planDate: { type: 'string', description: '计划日期 YYYY-MM-DD，必填' },
          projectName: { type: 'string', description: '项目名称，必填' },
          constructionUnit: { type: 'string', description: '施工单位，可选' },
          pourLocation: { type: 'string', description: '浇筑部位，必填' },
          receiveMethod: { type: 'string', description: '收件方式(微信/短信/app)，可选' },
          strengthGrade: { type: 'string', description: '标号如 C30，必填' },
          volume: { type: 'number', description: '方量 m³，必填' },
          branchId: { type: 'integer', description: '发料分公司ID(西站=1等)，必填' },
          plannedSendTime: { type: 'string', description: '计划发料时间 HH:mm，必填' },
          expectedDuration: { type: 'number', description: '预计持续时间 小时，必填' },
          boundMixDesignId: { type: 'integer', description: '配合比方案ID，必填' },
          remarks: { type: 'string', description: '备注，可选' }
        }
      },
      forceDelete: { type: 'boolean', description: '删除时有车次是否强制删除，默认false' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { dailyPlanService, logger } = context
    const { action, id, data, forceDelete } = args

    try {
      let result
      switch (action) {
        case 'get': result = await dailyPlanService.getById(id); break
        case 'create': result = await dailyPlanService.create(data); break
        case 'update': result = await dailyPlanService.update(id, data); break
        case 'delete': result = await dailyPlanService.delete(id, forceDelete); break
        default: throw new Error(`未知action: ${action}`)
      }
      logger.info(`每日计划 ${action} 成功`)
      return { success: true, data: result }
    } catch (error) {
      logger.error(`每日计划 ${action} 失败:`, error.message)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['dailyPlanService']
}