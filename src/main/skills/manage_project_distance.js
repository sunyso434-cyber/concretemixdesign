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
      id: { type: 'integer', description: 'update/delete时必填' },
      projectName: { type: 'string', description: '工程名称，getByProject和create必填' },
      // create/update 字段直接摊平到顶层（DeepSeek V4 对 flat 参数支持最好，嵌套 object 会传错）
      branchId: { type: 'integer', description: '搅拌站/分公司ID(西站=1等)，create必填' },
      distanceKm: { type: 'number', description: '距离 km，create必填' },
      baseTransportMin: { type: 'integer', description: '基础运输时间 min，create必填' },
      peakStart1: { type: 'string', description: '早高峰起 HH:mm，可选' },
      peakEnd1: { type: 'string', description: '早高峰止 HH:mm，可选' },
      peakStart2: { type: 'string', description: '晚高峰起 HH:mm，可选' },
      peakEnd2: { type: 'string', description: '晚高峰止 HH:mm，可选' },
      peakFactor: { type: 'number', description: '峰时系数，默认1.0，可选' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { projectDistanceService, logger } = context
    const { action, id, projectName } = args
    const FIELDS = ['projectName', 'branchId', 'distanceKm', 'baseTransportMin', 'peakStart1', 'peakEnd1', 'peakStart2', 'peakEnd2', 'peakFactor']
    const NUM_FIELDS = ['branchId', 'distanceKm', 'baseTransportMin', 'peakFactor']
    const num = (v) => { const n = Number(v); return isNaN(n) ? v : n }

    // 数据源合并：兼容 DeepSeek V4 的 data对象/data字符串/type|properties错位/顶层摊平
    let raw = {}
    for (const src of [args.data, args.properties, args.type]) {
      if (typeof src === 'string') { try { Object.assign(raw, JSON.parse(src)) } catch (_) {} }
      else if (src && typeof src === 'object') Object.assign(raw, src)
    }
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
      Object.assign(raw, raw.data)
    }
    delete raw.data
    for (const k of FIELDS) if (args[k] !== undefined) raw[k] = args[k]

    const data = {}
    for (const k of FIELDS) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') {
        data[k] = NUM_FIELDS.includes(k) ? num(raw[k]) : raw[k]
      }
    }

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