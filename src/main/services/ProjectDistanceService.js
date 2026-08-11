const { ProjectDistance, CapacityConfig } = require('../db/database')

class ProjectDistanceService {
  async getMatrix() {
    const rows = await ProjectDistance.findAll({ order: [['projectName', 'ASC'], ['branchId', 'ASC']] })
    return rows.map(r => r.toJSON())
  }

  async getByProject(projectName) {
    const rows = await ProjectDistance.findAll({ where: { projectName } })
    return rows.map(r => r.toJSON())
  }

  async getByBranch(branchId) {
    const rows = await ProjectDistance.findAll({ where: { branchId } })
    return rows.map(r => r.toJSON())
  }

  async create(data) {
    await this._checkBranchExists(data.branchId)
    try {
      const row = await ProjectDistance.create(data)
      return row.toJSON()
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') {
        const err = new Error('该工程到该站点的距离记录已存在')
        err.code = 'DUPLICATE_DISTANCE'
        throw err
      }
      throw e
    }
  }

  async update(id, data) {
    const row = await ProjectDistance.findByPk(id)
    if (!row) {
      const err = new Error('距离记录不存在')
      err.code = 'DISTANCE_NOT_FOUND'
      throw err
    }
    if (data.branchId) await this._checkBranchExists(data.branchId)
    await row.update(data)
    return row.toJSON()
  }

  async delete(id) {
    await ProjectDistance.destroy({ where: { id } })
    return true
  }

  async _checkBranchExists(branchId) {
    const branch = await CapacityConfig.findByPk(branchId)
    if (!branch) {
      const err = new Error('分公司不存在')
      err.code = 'E-CAP-001'
      throw err
    }
  }
}

module.exports = new ProjectDistanceService()
