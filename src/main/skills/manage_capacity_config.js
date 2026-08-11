/**
 * 产能配置管理 Skill
 * 管理各分公司产能配置(生产线/运输车/搅拌系数/搅拌楼号映射)
 */

module.exports = {
  name: 'manage_capacity_config',
  category: 'manage',
  description: '管理各分公司产能配置(生产线/运输车/搅拌系数/搅拌楼号映射)。action: create|update|delete|list|get。create/update需传data(含branchName,lineCount,c30Efficiency,mixerTowerNos,selfOilTruckCount等)。搅拌楼号跨记录查重(一个楼号只能配一个站)。删除时有引用会拒绝。',
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'list', 'get'] },
      id: { type: 'integer', description: 'get/update/delete时必填' },
      data: { type: 'object', description: 'create/update时必填' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { capacityConfigService, logger } = context
    const { action, id, data } = args

    try {
      let result
      switch (action) {
        case 'list': result = await capacityConfigService.getAll(); break
        case 'get': result = await capacityConfigService.getById(id); break
        case 'create': result = await capacityConfigService.create(data); break
        case 'update': result = await capacityConfigService.update(id, data); break
        case 'delete': result = await capacityConfigService.delete(id); break
        default: throw new Error(`未知action: ${action}`)
      }
      logger.info(`产能配置 ${action} 成功`)
      return { success: true, data: result }
    } catch (error) {
      logger.error(`产能配置 ${action} 失败:`, error.message)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['capacityConfigService']
}