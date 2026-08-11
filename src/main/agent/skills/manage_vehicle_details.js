// src/main/agent/skills/manage_vehicle_details.js
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const VehicleDetailService = require('../../services/VehicleDetailService')

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
  isWrite: true,
  async handler({ action, planId, detailId, id, data, filePath }) {
    switch (action) {
      case 'listByPlan': return await VehicleDetailService.getByPlanId(planId)
      case 'listUnmatched': return await VehicleDetailService.listUnmatched()
      case 'create': return await VehicleDetailService.create(data)
      case 'update': return await VehicleDetailService.update(id, data)
      case 'delete': return await VehicleDetailService.delete(id)
      case 'assign': return await VehicleDetailService.assignToPlan(detailId, planId)
      case 'import': return await this._import(filePath)
      default: throw new Error(`未知action: ${action}`)
    }
  },
  async _import(filePath) {
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
    return await VehicleDetailService.batchImport(rows)
  }
}
