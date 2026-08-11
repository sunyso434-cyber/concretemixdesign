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
      // create/update 字段直接摊平到顶层（DeepSeek V4 对 flat 参数支持最好，嵌套 object 会传错）
      branchName: { type: 'string', description: '分公司名称，create必填' },
      lineCount: { type: 'integer', description: '生产线数量，默认1' },
      lineSpec: { type: 'object', description: '生产线规格 JSON，可选' },
      mixerTowerNos: { type: 'array', items: { type: 'string' }, description: '搅拌楼号数组，如["1号楼","2号楼"]' },
      selfOilTruckCount: { type: 'integer', description: '自有油车数，默认0' },
      selfOilTruckPrice: { type: 'number', description: '自有油车单价(元/方·公里)，默认0' },
      selfOilTruckCapacity: { type: 'number', description: '自有油车容量 m³，默认8' },
      selfElecTruckCount: { type: 'integer', description: '自有电车数，默认0' },
      selfElecTruckPrice: { type: 'number', description: '自有电车单价，默认0' },
      selfElecTruckCapacity: { type: 'number', description: '自有电车容量 m³，默认8' },
      rentalTruckCount: { type: 'integer', description: '外租车数，默认0' },
      rentalTruckPrice: { type: 'number', description: '外租单价，默认0' },
      rentalTruckCapacity: { type: 'number', description: '外租容量 m³，默认8' },
      loadTimeMin: { type: 'integer', description: '装料时间 min，默认10' },
      unloadTimeMin: { type: 'integer', description: '卸料时间 min，默认10' },
      mixCoefficients: { type: 'object', description: '搅拌系数 JSON，如{"C30":1.0,"C40":1.1}' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { capacityConfigService, logger } = context
    const { action, id } = args
    // 摊平字段 → data 对象（AI 直接传顶层参数）
    const FIELDS = ['branchName', 'lineCount', 'lineSpec', 'mixerTowerNos', 'selfOilTruckCount', 'selfOilTruckPrice', 'selfOilTruckCapacity', 'selfElecTruckCount', 'selfElecTruckPrice', 'selfElecTruckCapacity', 'rentalTruckCount', 'rentalTruckPrice', 'rentalTruckCapacity', 'loadTimeMin', 'unloadTimeMin', 'mixCoefficients']
    const NUM_FIELDS = ['lineCount', 'selfOilTruckCount', 'selfOilTruckPrice', 'selfOilTruckCapacity', 'selfElecTruckCount', 'selfElecTruckPrice', 'selfElecTruckCapacity', 'rentalTruckCount', 'rentalTruckPrice', 'rentalTruckCapacity', 'loadTimeMin', 'unloadTimeMin']
    const JSON_FIELDS = ['lineSpec', 'mixerTowerNos', 'mixCoefficients']
    const num = (v) => { const n = Number(v); return isNaN(n) ? v : n }
    const parseJson = (v) => { if (typeof v === 'string') { try { return JSON.parse(v) } catch (_) { return v } } return v }
    const data = {}
    for (const k of FIELDS) {
      if (args[k] !== undefined && args[k] !== null && args[k] !== '') {
        data[k] = JSON_FIELDS.includes(k) ? parseJson(args[k]) : (NUM_FIELDS.includes(k) ? num(args[k]) : args[k])
      }
    }

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