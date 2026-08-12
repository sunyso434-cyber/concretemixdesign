// src/main/ipcHandlers/productionPlanHandler.js
const { ipcMain } = require('electron')
const CapacityConfigService = require('../services/CapacityConfigService')
const ProjectDistanceService = require('../services/ProjectDistanceService')
const DailyPlanService = require('../services/DailyPlanService')
const VehicleDetailService = require('../services/VehicleDetailService')

class ProductionPlanHandler {
  constructor() {
    this.registerHandlers()
  }

  /**
   * 统一错误处理：日志 + 归类 Sequelize 错误
   */
  _handleError(e) {
    console.error('[ProductionPlanHandler] error:', e)
    let code = e.code
    if (!code) {
      // Sequelize 等未带 code 的异常归到系统错误
      if (e.name === 'SequelizeUniqueConstraintError') code = 'DUPLICATE'
      else if (e.name === 'SequelizeValidationError') code = 'E-VALIDATION'
      else code = 'E-SYSTEM-001'
    }
    return { success: false, error: { code, message: e.message } }
  }

  registerHandlers() {
    // === 每日计划 ===
    ipcMain.handle('dailyPlan:list', async (_, { date, branchId }) => {
      try {
        const data = await DailyPlanService.listByDate(date, branchId)
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('dailyPlan:listRecentProjects', async () => {
      try {
        const data = await DailyPlanService.listRecentProjectNames(30)
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('dailyPlan:listWithDetails', async (_, { date, branchId }) => {
      try {
        const plans = await DailyPlanService.listWithVehicleDetails(date, branchId)
        // 算派生值
        const data = plans.map(p => ({
          ...p,
          progressPercent: p.volume > 0 ? Math.round(p.executedVolume / p.volume * 100) : 0,
          status: DailyPlanService.deriveStatus(p.executedVolume, p.volume),
          overBudget: DailyPlanService.deriveOverBudget(p.executedVolume, p.volume)
        }))
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('dailyPlan:get', async (_, { id }) => {
      try {
        const plan = await DailyPlanService.getById(id)
        plan.progressPercent = plan.volume > 0 ? Math.round(plan.executedVolume / plan.volume * 100) : 0
        plan.status = DailyPlanService.deriveStatus(plan.executedVolume, plan.volume)
        plan.overBudget = DailyPlanService.deriveOverBudget(plan.executedVolume, plan.volume)
        return { success: true, data: plan }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('dailyPlan:create', async (_, { data }) => {
      try {
        const row = await DailyPlanService.create(data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('dailyPlan:update', async (_, { id, data }) => {
      try {
        const row = await DailyPlanService.update(id, data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('dailyPlan:delete', async (_, { id, forceDelete }) => {
      try {
        await DailyPlanService.delete(id, forceDelete)
        return { success: true, data: true }
      } catch (e) { return this._handleError(e) }
    })

    // === 每车明细 ===
    ipcMain.handle('vehicleDetail:listByPlan', async (_, { planId }) => {
      try {
        const data = await VehicleDetailService.getByPlanId(planId)
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('vehicleDetail:create', async (_, { data }) => {
      try {
        const row = await VehicleDetailService.create(data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('vehicleDetail:update', async (_, { id, data }) => {
      try {
        const row = await VehicleDetailService.update(id, data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('vehicleDetail:delete', async (_, { id }) => {
      try {
        await VehicleDetailService.delete(id)
        return { success: true, data: true }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('vehicleDetail:assign', async (_, { detailId, planId }) => {
      try {
        const row = await VehicleDetailService.assignToPlan(detailId, planId)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('vehicleDetail:listUnmatched', async () => {
      try {
        const data = await VehicleDetailService.listUnmatched()
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    // === 产能配置 ===
    ipcMain.handle('capacity:getAll', async () => {
      try {
        const data = await CapacityConfigService.getAll()
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('capacity:getById', async (_, { id }) => {
      try {
        const data = await CapacityConfigService.getById(id)
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('capacity:create', async (_, { data }) => {
      try {
        const row = await CapacityConfigService.create(data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('capacity:update', async (_, { id, data }) => {
      try {
        const row = await CapacityConfigService.update(id, data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('capacity:delete', async (_, { id }) => {
      try {
        await CapacityConfigService.delete(id)
        return { success: true, data: true }
      } catch (e) { return this._handleError(e) }
    })

    // === 距离表 ===
    ipcMain.handle('distance:getMatrix', async () => {
      try {
        const data = await ProjectDistanceService.getMatrix()
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('distance:getByProject', async (_, { projectName }) => {
      try {
        const data = await ProjectDistanceService.getByProject(projectName)
        return { success: true, data }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('distance:create', async (_, { data }) => {
      try {
        const row = await ProjectDistanceService.create(data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('distance:update', async (_, { id, data }) => {
      try {
        const row = await ProjectDistanceService.update(id, data)
        return { success: true, data: row }
      } catch (e) { return this._handleError(e) }
    })

    ipcMain.handle('distance:delete', async (_, { id }) => {
      try {
        await ProjectDistanceService.delete(id)
        return { success: true, data: true }
      } catch (e) { return this._handleError(e) }
    })
  }
}

module.exports = new ProductionPlanHandler()