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
      planId: { type: 'integer' },
      detailId: { type: 'integer' },
      id: { type: 'integer' },
      data: { type: 'object' },
      filePath: { type: 'string', description: 'import时必填，工作区内Excel路径' }
    },
    required: ['action']
  },

  async execute(args, context) {
    const { vehicleDetailService, logger } = context
    const { action, planId, detailId, id, data, filePath } = args

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