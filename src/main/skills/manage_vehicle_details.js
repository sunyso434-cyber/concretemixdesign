/**
 * 每车明细管理 Skill
 * 管理每车明细(含Excel导入)
 */
const fs = require('fs')
const XLSX = require('xlsx')

// ponytail: 私有 import 工具留在文件内；Excel 读取保持直接调用以贴合 legacy 模式
async function _importFromExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`文件不存在: ${filePath}`)
    err.code = 'E-IMPORT-001'
    throw err
  }
  let workbook
  try {
    workbook = XLSX.readFile(filePath)
  } catch (e) {
    const err = new Error(`文件解析失败: ${e.message}`)
    err.code = 'E-IMPORT-002'
    throw err
  }
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  return rows
}

module.exports = {
  name: 'manage_vehicle_details',
  category: 'manage',
  description: `管理每车明细(含Excel导入)。action:
- create|update|delete|listByPlan|listUnmatched|assign|import
- import: 从工作区Excel导入每车明细，自动匹配到当日计划。参数filePath(工作区内路径)。
  匹配键=工程名+部位+标号+branchId(通过搅拌楼号映射)，planDate查当天或前一天(支持跨零点)。
  重复导入靠(shipmentNo+productionDate)幂等去重，归skipped。
  匹配不上的进unmatched，聚合missingPlans提醒用户补建计划。
  补建后用assign关联。
- assign: 把unmatched车次关联到计划，参数detailId+planId。
导入结果处理:
- missingPlans非空: 提醒"发现K条找不到对应计划，是否补建？"
- invalidCount>0: 告知格式错误行
- skippedCount>0: 告知重复跳过`,
  version: '1.0.0',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'listByPlan', 'listUnmatched', 'assign', 'import'] },
      planId: { type: 'integer', description: 'listByPlan/assign时必填' },
      detailId: { type: 'integer', description: 'assign时必填' },
      id: { type: 'integer', description: 'update/delete时必填' },
      // create/update 字段直接摊平到顶层（DeepSeek V4 对 flat 参数支持最好，嵌套 object 会传错）
      mixerTowerNo: { type: 'string', description: '搅拌楼号，create必填' },
      productionDate: { type: 'string', description: '生产日期 YYYY-MM-DD，create必填' },
      productionTime: { type: 'string', description: '生产时间 HH:mm，create必填' },
      shipmentNo: { type: 'string', description: '发货号，create必填' },
      projectName: { type: 'string', description: '工程名称，create必填' },
      pourLocation: { type: 'string', description: '工程部位，create必填' },
      strengthGrade: { type: 'string', description: '标号如 C30，create必填' },
      volume: { type: 'number', description: '方量 m³，create必填' },
      taskOrderNo: { type: 'string', description: '任务单号，可选' },
      constructionUnit: { type: 'string', description: '施工单位，可选' },
      operator: { type: 'string', description: '操作工，可选' },
      plateNo: { type: 'string', description: '车牌号，可选' },
      vehicleNo: { type: 'string', description: '车号，可选' },
      driver: { type: 'string', description: '驾驶员，可选' },
      supplyMethod: { type: 'string', description: '供应方式，可选' },
      filePath: { type: 'string', description: 'import时必填，工作区内Excel路径' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { vehicleDetailService, logger } = context
    const { action, planId, detailId, id, filePath } = args
    const FIELDS = ['mixerTowerNo', 'productionDate', 'productionTime', 'shipmentNo', 'projectName', 'pourLocation', 'strengthGrade', 'volume', 'taskOrderNo', 'constructionUnit', 'operator', 'plateNo', 'vehicleNo', 'driver', 'supplyMethod']
    const NUM_FIELDS = ['volume']
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
        case 'listByPlan': result = await vehicleDetailService.getByPlanId(planId); break
        case 'listUnmatched': result = await vehicleDetailService.listUnmatched(); break
        case 'create': result = await vehicleDetailService.create(data); break
        case 'update': result = await vehicleDetailService.update(id, data); break
        case 'delete': result = await vehicleDetailService.delete(id); break
        case 'assign': result = await vehicleDetailService.assignToPlan(detailId, planId); break
        case 'import': {
          const rows = await _importFromExcel(filePath)
          result = await vehicleDetailService.batchImport(rows)
          break
        }
        default: throw new Error(`未知action: ${action}`)
      }
      logger.info(`车次明细 ${action} 成功`)
      return { success: true, data: result }
    } catch (error) {
      logger.error(`车次明细 ${action} 失败:`, error.message)
      return { success: false, error: { code: error.code || 'E-SYSTEM', message: error.message } }
    }
  },

  services: ['vehicleDetailService']
}