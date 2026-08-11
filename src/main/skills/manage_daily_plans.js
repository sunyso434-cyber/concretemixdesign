/**
 * 每日计划管理 Skill
 * 管理每日生产调度计划(CRUD)
 */

module.exports = {
  name: 'manage_daily_plans',
  category: 'manage',
  description: `管理每日生产调度计划(CRUD)。action: create|update|delete|get。同一天同工程同部位同标号同站只能一条。匹配键字段(planDate/projectName/pourLocation/strengthGrade/branchId)不可修改。mixDesignId必填。有车次时不可删除(用forceDelete=true强制删，会置车次planId=NULL)。

正确调用示例（所有字段作为平级参数直接传，不要包data对象）:
{"action":"create","planDate":"2026-08-06","projectName":"某某项目","pourLocation":"某某部位","strengthGrade":"C30","branchId":1,"volume":100,"startTime":"08:00","duration":4,"mixDesignId":186}`,
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'get'] },
      id: { type: 'integer', description: 'update/delete/get时必填' },
      forceDelete: { type: 'boolean', description: '删除时有车次是否强制删除，默认false' },
      // create/update 字段直接摊平到顶层（DeepSeek V4 对 flat 参数支持最好，嵌套 object 会传错）
      // 字段名取 AI 直觉名（startTime/duration/mixDesignId），execute 内部映射到模型字段
      planDate: { type: 'string', description: '计划日期 YYYY-MM-DD，create必填' },
      projectName: { type: 'string', description: '项目名称，create必填' },
      constructionUnit: { type: 'string', description: '施工单位，可选' },
      pourLocation: { type: 'string', description: '浇筑部位，create必填' },
      receiveMethod: { type: 'string', description: '收件方式(微信/短信/app)，可选' },
      strengthGrade: { type: 'string', description: '标号如 C30，create必填' },
      volume: { type: 'number', description: '方量 m³，create必填' },
      branchId: { type: 'integer', description: '发料分公司ID(西站=1等)，create必填' },
      startTime: { type: 'string', description: '计划发料时间 HH:mm，create必填' },
      duration: { type: 'number', description: '预计持续时间 小时，create必填' },
      mixDesignId: { type: 'integer', description: '配合比方案ID，create必填' },
      remarks: { type: 'string', description: '备注，可选' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { dailyPlanService, logger } = context
    const { action, id, forceDelete } = args
    const FIELDS = ['planDate', 'projectName', 'constructionUnit', 'pourLocation', 'receiveMethod', 'strengthGrade', 'volume', 'branchId', 'plannedSendTime', 'expectedDuration', 'boundMixDesignId', 'remarks']
    const NUM_FIELDS = ['volume', 'branchId', 'expectedDuration', 'boundMixDesignId']
    // 字段别名（AI 从表格直译的列名 → 标准字段）：startTime/duration/mixDesignId/notes
    const ALIAS = { startTime: 'plannedSendTime', duration: 'expectedDuration', mixDesignId: 'boundMixDesignId', notes: 'remarks' }
    const num = (v) => { const n = Number(v); return isNaN(n) ? v : n }

    // 数据源合并：DeepSeek V4 会用各种方式传参（data对象/data字符串/type|properties错位/顶层摊平），全兼容
    let raw = {}
    for (const src of [args.data, args.properties, args.type]) {
      if (typeof src === 'string') { try { Object.assign(raw, JSON.parse(src)) } catch (_) {} }
      else if (src && typeof src === 'object') Object.assign(raw, src)
    }
    // 展开嵌套 data（AI 常把字段包在 data 对象里）
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
      Object.assign(raw, raw.data)
    }
    delete raw.data
    // 顶层字段覆盖（含直觉别名字段名，如 startTime/duration/mixDesignId）
    for (const k of [...FIELDS, ...Object.keys(ALIAS)]) if (args[k] !== undefined) raw[k] = args[k]
    // 别名归一（标准字段已有时不覆盖）
    for (const [alias, real] of Object.entries(ALIAS)) {
      if (raw[alias] !== undefined && raw[real] === undefined) raw[real] = raw[alias]
    }
    // 组装 data
    const data = {}
    for (const k of FIELDS) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') {
        data[k] = NUM_FIELDS.includes(k) ? num(raw[k]) : raw[k]
      }
    }

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