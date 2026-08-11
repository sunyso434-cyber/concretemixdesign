/**
 * 工程距离管理 Skill
 * 管理工程到各搅拌站的距离与运输时间(含高峰系数)
 */

module.exports = {
  name: 'manage_project_distance',
  category: 'manage',
  description: '管理工程到各搅拌站的距离与运输时间(含高峰系数)。action: create|update|delete|list|getMatrix|getByProject。create/update需传data(含projectName,branchId,distanceKm,baseTransportMin,peakStart1等)。',
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'list', 'getMatrix', 'getByProject'] },
      id: { type: 'integer' },
      projectName: { type: 'string' },
      data: {
        type: 'object',
        description: 'create/update时必填。必须是JSON对象(不能是JSON字符串)，字段如下。必填: projectName,branchId,distanceKm,baseTransportMin',
        properties: {
          projectName: { type: 'string', description: '工程名称，必填' },
          branchId: { type: 'integer', description: '搅拌站/分公司ID(西站=1等)，必填' },
          distanceKm: { type: 'number', description: '距离 km，必填' },
          baseTransportMin: { type: 'integer', description: '基础运输时间 min，必填' },
          peakStart1: { type: 'string', description: '早高峰起 HH:mm，可选' },
          peakEnd1: { type: 'string', description: '早高峰止 HH:mm，可选' },
          peakStart2: { type: 'string', description: '晚高峰起 HH:mm，可选' },
          peakEnd2: { type: 'string', description: '晚高峰止 HH:mm，可选' },
          peakFactor: { type: 'number', description: '峰时系数，默认1.0，可选' }
        }
      }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { projectDistanceService, logger } = context
    const { action, id, projectName, data } = args

    try {
      let result
      switch (action) {
        case 'list':
        case 'getMatrix': result = await projectDistanceService.getMatrix(); break
        case 'getByProject': result = await projectDistanceService.getByProject(projectName); break
        case 'create': result = await projectDistanceService.create(data); break
        case 'update': result = await projectDistanceService.update(id, data); break
        case 'delete': result = await projectDistanceService.delete(id); break
        default: throw new Error(`未知action: ${action}`)
      }
      logger.info(`工程距离 ${action} 成功`)
      return { success: true, data: result }
    } catch (error) {
      logger.error(`工程距离 ${action} 失败:`, error.message)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['projectDistanceService']
}