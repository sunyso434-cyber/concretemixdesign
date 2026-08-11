// src/main/agent/skills/manage_capacity_config.js
const CapacityConfigService = require('../../services/CapacityConfigService')

module.exports = {
  name: 'manage_capacity_config',
  category: 'manage',
  description: '管理各分公司产能配置(生产线/运输车/搅拌系数/搅拌楼号映射)。action: create|update|delete|list|get。create/update需传data(含branchName,lineCount,c30Efficiency,mixerTowerNos,selfOilTruckCount等)。搅拌楼号跨记录查重(一个楼号只能配一个站)。删除时有引用会拒绝。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'list', 'get'] },
      id: { type: 'integer', description: 'get/update/delete时必填' },
      data: { type: 'object', description: 'create/update时必填' }
    },
    required: ['action']
  },
  isWrite: true,
  async handler({ action, id, data }) {
    switch (action) {
      case 'list': return await CapacityConfigService.getAll()
      case 'get': return await CapacityConfigService.getById(id)
      case 'create': return await CapacityConfigService.create(data)
      case 'update': return await CapacityConfigService.update(id, data)
      case 'delete': return await CapacityConfigService.delete(id)
      default: throw new Error(`未知action: ${action}`)
    }
  }
}
