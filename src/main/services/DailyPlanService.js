const { Op } = require('sequelize')
const { DailyPlan, VehicleDetail } = require('../db/database')

const MATCH_KEYS = ['planDate', 'projectName', 'pourLocation', 'strengthGrade', 'branchId']

class DailyPlanService {
  async create(data) {
    if (!data) {
      const err = new Error('计划数据缺失')
      err.code = 'E-VALIDATION'
      throw err
    }
    // v0.8.1：配合比改为分公司绑定，计划不再校验 boundMixDesignId
    try {
      const row = await DailyPlan.create(data)
      return row.toJSON()
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') {
        const err = new Error('计划重复(同天同工程同部位同标号同站)')
        err.code = 'E-PLAN-002'
        throw err
      }
      throw e
    }
  }

  async update(id, data) {
    const row = await DailyPlan.findByPk(id)
    if (!row) {
      const err = new Error('计划不存在')
      err.code = 'E-PLAN-001'
      throw err
    }
    // 匹配键字段不可修改（spec §3.5）
    for (const key of MATCH_KEYS) {
      if (key in data && data[key] !== row[key]) {
        const err = new Error(`匹配键字段 ${key} 不可修改`)
        err.code = 'E-PLAN-004'
        throw err
      }
    }
    await row.update(data)
    return row.toJSON()
  }

  async delete(id, forceDelete = false) {
    const row = await DailyPlan.findByPk(id)
    if (!row) {
      const err = new Error('计划不存在')
      err.code = 'E-PLAN-001'
      throw err
    }
    const vehicleCount = await VehicleDetail.count({ where: { planId: id } })
    if (vehicleCount > 0 && !forceDelete) {
      const err = new Error(`该计划有 ${vehicleCount} 条车次，不可删除(用forceDelete强制删)`)
      err.code = 'E-PLAN-003'
      throw err
    }
    if (vehicleCount > 0 && forceDelete) {
      await VehicleDetail.update(
        { planId: null, unmatchedReason: 'PLAN_FORCE_DELETED' },
        { where: { planId: id } }
      )
    }
    await DailyPlan.destroy({ where: { id } })
    return true
  }

  async getById(id) {
    const row = await DailyPlan.findByPk(id)
    if (!row) {
      const err = new Error('计划不存在')
      err.code = 'E-PLAN-001'
      throw err
    }
    const result = row.toJSON()
    const agg = await this._getVehicleAggregate(id)
    Object.assign(result, agg)
    return result
  }

  async listByDate(date, branchId = null) {
    const where = { planDate: date }
    if (branchId) where.branchId = branchId
    const rows = await DailyPlan.findAll({ where, order: [['plannedSendTime', 'ASC']] })
    const result = []
    for (const row of rows) {
      const plan = row.toJSON()
      const agg = await this._getVehicleAggregate(plan.id)
      Object.assign(plan, agg)
      plan.progressPercent = plan.volume > 0 ? Math.round(plan.executedVolume / plan.volume * 100) : 0
      plan.status = this.deriveStatus(plan.executedVolume, plan.volume)
      plan.overBudget = this.deriveOverBudget(plan.executedVolume, plan.volume)
      result.push(plan)
    }
    return result
  }

  /**
   * 查询最近N天的 DISTINCT projectName（用于前端 AutoComplete）
   */
  async listRecentProjectNames(days = 30) {
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - days)
    const startStr = startDate.toISOString().slice(0, 10)
    const rows = await DailyPlan.findAll({
      where: { planDate: { [Op.gte]: startStr } },
      attributes: ['projectName'],
      group: ['projectName'],
      order: [['projectName', 'ASC']]
    })
    return rows.map(r => r.projectName)
  }

  async listWithVehicleDetails(date, branchId = null) {
    const where = { planDate: date }
    if (branchId) where.branchId = branchId
    const rows = await DailyPlan.findAll({ where, order: [['plannedSendTime', 'ASC']] })
    const result = []
    for (const row of rows) {
      const plan = row.toJSON()
      const agg = await this._getVehicleAggregate(plan.id)
      Object.assign(plan, agg)
      result.push(plan)
    }
    return result
  }

  /**
   * 算派生值：executedVolume / vehicleCount / progressPercent / overBudget / status
   */
  async _getVehicleAggregate(planId) {
    const vehicles = await VehicleDetail.findAll({
      where: { planId },
      attributes: ['id', 'volume']
    })
    const vehicleCount = vehicles.length
    const executedVolume = vehicles.reduce((sum, v) => sum + (v.volume || 0), 0)
    return { vehicleCount, executedVolume }
  }

  /**
   * 派生 status（spec 2.8）
   */
  deriveStatus(executedVolume, volume) {
    if (executedVolume === 0) return 'planned'
    if (executedVolume >= volume) return 'completed'
    return 'executing'
  }

  deriveOverBudget(executedVolume, volume) {
    return executedVolume > volume
  }
}

module.exports = new DailyPlanService()
