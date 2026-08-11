// src/main/agent/skills/manage_project_distance.js
const ProjectDistanceService = require('../../services/ProjectDistanceService')

module.exports = {
  name: 'manage_project_distance',
  category: 'manage',
  description: '管理工程到各搅拌站的距离与运输时间(含高峰系数)。action: create|update|delete|list|getMatrix|getByProject。create/update需传data(含projectName,branchId,distanceKm,baseTransportMin,peakStart1等)。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'list', 'getMatrix', 'getByProject'] },
      id: { type: 'integer' },
      projectName: { type: 'string' },
      data: { type: 'object' }
    },
    required: ['action']
  },
  isWrite: true,
  async handler({ action, id, projectName, data }) {
    switch (action) {
      case 'list':
      case 'getMatrix': return await ProjectDistanceService.getMatrix()
      case 'getByProject': return await ProjectDistanceService.getByProject(projectName)
      case 'create': return await ProjectDistanceService.create(data)
      case 'update': return await ProjectDistanceService.update(id, data)
      case 'delete': return await ProjectDistanceService.delete(id)
      default: throw new Error(`未知action: ${action}`)
    }
  }
}
