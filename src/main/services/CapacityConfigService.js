const { CapacityConfig, DailyPlan, VehicleDetail, ProjectDistance } = require('../db/database')

class CapacityConfigService {
  async getAll() {
    const rows = await CapacityConfig.findAll({ order: [['id', 'ASC']] })
    return rows.map(r => r.toJSON())
  }

  async getById(id) {
    const row = await CapacityConfig.findByPk(id)
    if (!row) {
      const err = new Error('产能配置不存在')
      err.code = 'E-CAP-001'
      throw err
    }
    return row.toJSON()
  }

  async create(data) {
    // 搅拌楼号跨记录查重
    await this._checkMixerTowerNosConflict(data.mixerTowerNos || [])
    const row = await CapacityConfig.create(data)
    return row.toJSON()
  }

  async update(id, data) {
    const row = await CapacityConfig.findByPk(id)
    if (!row) {
      const err = new Error('产能配置不存在')
      err.code = 'E-CAP-001'
      throw err
    }
    if (data.mixerTowerNos) {
      await this._checkMixerTowerNosConflict(data.mixerTowerNos, id)
    }
    await row.update(data)
    return row.toJSON()
  }

  async delete(id) {
    // 引用检查
    const planCount = await DailyPlan.count({ where: { branchId: id } })
    if (planCount > 0) {
      const err = new Error(`该分公司有 ${planCount} 条计划引用，不可删除`)
      err.code = 'E-CAP-001'
      throw err
    }
    const distCount = await ProjectDistance.count({ where: { branchId: id } })
    if (distCount > 0) {
      const err = new Error(`该分公司有 ${distCount} 条距离记录引用，不可删除`)
      err.code = 'E-CAP-001'
      throw err
    }
    await CapacityConfig.destroy({ where: { id } })
    return true
  }

  async _checkMixerTowerNosConflict(towerNos, excludeId = null) {
    const all = await CapacityConfig.findAll()
    for (const row of all) {
      if (excludeId && row.id === excludeId) continue
      const existing = row.mixerTowerNos || []
      const conflict = towerNos.find(n => existing.includes(n))
      if (conflict) {
        const err = new Error(`搅拌楼号 "${conflict}" 已被 ${row.branchName} 配置，一个楼号只能配一个站`)
        err.code = 'E-CAP-002'
        throw err
      }
    }
  }
}

module.exports = new CapacityConfigService()
