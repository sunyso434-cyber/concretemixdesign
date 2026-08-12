const { Op } = require('sequelize')
const { VehicleDetail, DailyPlan, CapacityConfig } = require('../db/database')

const FIELD_ALIASES = {
  mixerTowerNo: ['搅拌楼号', '楼号'],
  productionDate: ['生产日期'],
  productionTime: ['生产时间'],
  taskOrderNo: ['任务单号', '任务号'],
  shipmentNo: ['发货号'],
  constructionUnit: ['施工单位'],
  projectName: ['工程名称', '工程名', '项目名称'],
  pourLocation: ['工程部位', '部位', '浇筑部位'],
  strengthGrade: ['技术要求', '标号', '强度等级'],
  operator: ['操作工', '操作员'],
  volume: ['方量', '方数'],
  plateNo: ['车牌号'],
  vehicleNo: ['车号'],
  driver: ['驾驶员', '司机'],
  supplyMethod: ['供应方式']
}

class VehicleDetailService {
  async getByPlanId(planId) {
    const rows = await VehicleDetail.findAll({
      where: { planId },
      order: [['productionTime', 'ASC']]
    })
    return rows.map(r => r.toJSON())
  }

  async listUnmatched() {
    const rows = await VehicleDetail.findAll({
      where: { planId: null },
      order: [['productionDate', 'ASC'], ['productionTime', 'ASC']]
    })
    return rows.map(r => r.toJSON())
  }

  async create(data) {
    const row = await VehicleDetail.create({ ...data, source: 'manual' })
    return row.toJSON()
  }

  async update(id, data) {
    const row = await VehicleDetail.findByPk(id)
    if (!row) {
      const err = new Error('车次不存在')
      err.code = 'VEHICLE_NOT_FOUND'
      throw err
    }
    await row.update(data)
    return row.toJSON()
  }

  async delete(id) {
    await VehicleDetail.destroy({ where: { id } })
    return true
  }

  async assignToPlan(detailId, planId) {
    const row = await VehicleDetail.findByPk(detailId)
    if (!row) {
      const err = new Error('车次不存在')
      err.code = 'VEHICLE_NOT_FOUND'
      throw err
    }
    const plan = await DailyPlan.findByPk(planId)
    if (!plan) {
      const err = new Error('计划不存在')
      err.code = 'E-PLAN-001'
      throw err
    }
    await row.update({ planId, unmatchedReason: null })
    return row.toJSON()
  }

  /**
   * 把 Excel 2D 数组映射成对象数组
   * @param {Array<Array>} rows - sheet_to_json(header:1) 的输出
   */
  mapRows(rows) {
    if (!rows || rows.length < 2) return []
    const header = rows[0].map(h => String(h || '').trim())
    const colMap = {} // 字段名 → 列索引
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      for (let i = 0; i < header.length; i++) {
        if (aliases.includes(header[i])) {
          colMap[field] = i
          break
        }
      }
    }
    const result = []
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row || row.every(c => c === null || c === undefined || c === '')) continue
      const obj = {}
      for (const [field, colIdx] of Object.entries(colMap)) {
        obj[field] = row[colIdx]
      }
      obj._rowNum = r + 1
      result.push(obj)
    }
    return result
  }

  normalizeStrengthGrade(grade) {
    if (!grade) return grade
    const s = String(grade).trim().toUpperCase()
    const m = s.match(/C\d+/i)
    return m ? m[0].toUpperCase() : s
  }

  /**
   * 搅拌楼号 → branchId 映射
   */
  async mapTowerToBranchId(mixerTowerNo) {
    const allConfig = await CapacityConfig.findAll()
    for (const config of allConfig) {
      const towers = config.mixerTowerNos || []
      if (towers.includes(mixerTowerNo)) {
        return config.id
      }
    }
    return null
  }

  /**
   * 匹配 DailyPlan（spec 6.9 / 7.4）
   * 返回 planId 或 null
   * 优先级: 未完成的当天 > 未完成的前一天 > 任意一条(极端兜底) > NO_PLAN
   */
  async matchPlan(row) {
    const branchId = await this.mapTowerToBranchId(row.mixerTowerNo)
    if (!branchId) return { planId: null, reason: 'NO_BRANCH_MAPPING' }

    const prodDate = String(row.productionDate)
    const d = new Date(prodDate)
    d.setDate(d.getDate() - 1)
    const prevDate = d.toISOString().slice(0, 10)

    const matchKeys = {
      projectName: row.projectName,
      pourLocation: row.pourLocation,
      strengthGrade: this.normalizeStrengthGrade(row.strengthGrade),
      branchId
    }

    // a. 先查当天未完成的
    let plans = await DailyPlan.findAll({ where: { ...matchKeys, planDate: prodDate } })
    let candidate = await this._filterNotCompleted(plans)
    if (candidate) return { planId: candidate.id, reason: null }

    // b. 再查前一天未完成的
    plans = await DailyPlan.findAll({ where: { ...matchKeys, planDate: prevDate } })
    candidate = await this._filterNotCompleted(plans)
    if (candidate) return { planId: candidate.id, reason: null }

    // c. 极端兜底: 当天或前一天至少一条未完成时分配(避免双已完成时错分配)
    //    注意: 步骤a/b已覆盖"有未完成"的情况,这里只处理"查询时刚完成但需兜底"的极端场景
    //    若两条都已完成 → 走 d 步 NO_PLAN(让用户补建计划)
    const allPlans = await DailyPlan.findAll({
      where: { ...matchKeys, planDate: { [Op.in]: [prodDate, prevDate] } }
    })
    const notCompleted = await this._filterNotCompleted(allPlans)
    if (notCompleted) {
      return { planId: notCompleted.id, reason: null }
    }

    // d. 无命中或全部已完成 → NO_PLAN
    return { planId: null, reason: 'NO_PLAN' }
  }

  async _filterNotCompleted(plans) {
    for (const plan of plans) {
      const vehicles = await VehicleDetail.findAll({
        where: { planId: plan.id },
        attributes: ['volume']
      })
      const executed = vehicles.reduce((s, v) => s + (v.volume || 0), 0)
      if (executed < plan.volume) return plan // 未完成
    }
    return null
  }

  /**
   * 批量导入（spec 7.1 / 7.5）
   * @param {Array<Array>} rows - sheet_to_json(header:1) 输出
   * @returns {matchedCount, unmatchedCount, invalidCount, skippedCount, missingPlans, unmatched, invalid, skipped}
   */
  async batchImport(rows) {
    const mapped = this.mapRows(rows)
    const result = {
      totalRows: mapped.length,
      matchedCount: 0, unmatchedCount: 0, invalidCount: 0, skippedCount: 0,
      missingPlans: [], unmatched: [], invalid: [], skipped: []
    }

    for (const row of mapped) {
      // 校验必填
      const validation = this._validateRow(row)
      if (!validation.valid) {
        result.invalidCount++
        result.invalid.push({ row: row._rowNum, reason: validation.reason })
        continue
      }

      // 标准化
      row.strengthGrade = this.normalizeStrengthGrade(row.strengthGrade)
      row.productionDate = String(row.productionDate).slice(0, 10)

      // 匹配计划
      const { planId, reason } = await this.matchPlan(row)

      // 插入（捕获唯一约束冲突归 skipped）
      try {
        await VehicleDetail.create({
          planId,
          mixerTowerNo: row.mixerTowerNo,
          productionDate: row.productionDate,
          productionTime: String(row.productionTime),
          taskOrderNo: row.taskOrderNo || null,
          shipmentNo: String(row.shipmentNo),
          constructionUnit: row.constructionUnit || null,
          projectName: row.projectName,
          pourLocation: row.pourLocation,
          strengthGrade: row.strengthGrade,
          operator: row.operator || null,
          volume: Number(row.volume),
          plateNo: row.plateNo || null,
          vehicleNo: row.vehicleNo || null,
          driver: row.driver || null,
          supplyMethod: row.supplyMethod || null,
          source: 'import',
          unmatchedReason: planId ? null : reason
        })
        if (planId) {
          result.matchedCount++
        } else {
          result.unmatchedCount++
          result.unmatched.push({ row: row._rowNum, reason })
          this._aggregateMissingPlans(result.missingPlans, row, reason)
        }
      } catch (e) {
        if (e.name === 'SequelizeUniqueConstraintError') {
          result.skippedCount++
          result.skipped.push({
            shipmentNo: row.shipmentNo,
            productionDate: row.productionDate,
            reason: '重复(发货号+生产日期已存在)'
          })
        } else {
          result.invalidCount++
          result.invalid.push({ row: row._rowNum, reason: e.message })
        }
      }
    }

    return result
  }

  _validateRow(row) {
    const required = ['mixerTowerNo', 'productionDate', 'productionTime',
                      'projectName', 'pourLocation', 'strengthGrade',
                      'volume', 'shipmentNo']
    for (const f of required) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        return { valid: false, reason: `必填字段 ${f} 缺失` }
      }
    }
    if (isNaN(Number(row.volume)) || Number(row.volume) <= 0) {
      return { valid: false, reason: '方量必须为正数' }
    }
    return { valid: true }
  }

  _aggregateMissingPlans(missingPlans, row, reason) {
    if (reason === 'NO_BRANCH_MAPPING') return // 搅拌楼号没映射的不进 missingPlans
    const key = `${row.projectName}|${row.pourLocation}|${row.strengthGrade}|${row.productionDate}`
    const existing = missingPlans.find(m =>
      `${m.projectName}|${m.pourLocation}|${m.strengthGrade}|${m.productionDate}` === key
    )
    if (existing) {
      existing.vehicleCount++
      existing.totalVolume += Number(row.volume)
    } else {
      missingPlans.push({
        projectName: row.projectName,
        pourLocation: row.pourLocation,
        strengthGrade: row.strengthGrade,
        productionDate: row.productionDate,
        vehicleCount: 1,
        totalVolume: Number(row.volume)
      })
    }
  }
}

module.exports = new VehicleDetailService()