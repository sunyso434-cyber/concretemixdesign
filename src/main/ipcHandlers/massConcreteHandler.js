const { ipcMain } = require('electron')
const InsulationMaterialService = require('../services/InsulationMaterialService')
const MassConcreteHeatDissipation = require('../db/models/MassConcreteHeatDissipation')

class MassConcreteHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // ========== 保温材料管理 ==========

    // 获取所有保温材料
    ipcMain.handle('mc_getAllInsulationMaterials', async () => {
      try {
        const materials = await InsulationMaterialService.getAllMaterials()
        return { success: true, data: materials }
      } catch (error) {
        console.error('mc_getAllInsulationMaterials failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取默认保温材料
    ipcMain.handle('mc_getDefaultInsulationMaterials', async () => {
      try {
        const materials = await InsulationMaterialService.getDefaultMaterials()
        return { success: true, data: materials }
      } catch (error) {
        console.error('mc_getDefaultInsulationMaterials failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取保温材料详情
    ipcMain.handle('mc_getInsulationMaterialById', async (_, id) => {
      try {
        const material = await InsulationMaterialService.getMaterialById(id)
        return { success: true, data: material }
      } catch (error) {
        console.error('mc_getInsulationMaterialById failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 创建保温材料
    ipcMain.handle('mc_createInsulationMaterial', async (_, data) => {
      try {
        const material = await InsulationMaterialService.createMaterial(data)
        return { success: true, data: material }
      } catch (error) {
        console.error('mc_createInsulationMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新保温材料
    ipcMain.handle('mc_updateInsulationMaterial', async (_, { id, data }) => {
      try {
        const material = await InsulationMaterialService.updateMaterial(id, data)
        return { success: true, data: material }
      } catch (error) {
        console.error('mc_updateInsulationMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 删除保温材料
    ipcMain.handle('mc_deleteInsulationMaterial', async (_, id) => {
      try {
        await InsulationMaterialService.deleteMaterial(id)
        return { success: true }
      } catch (error) {
        console.error('mc_deleteInsulationMaterial failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 方案管理 ==========

    // 获取所有方案
    ipcMain.handle('mc_getAllSchemes', async () => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const schemes = await MassConcreteSchemeService.getAllSchemes()
        return { success: true, data: schemes }
      } catch (error) {
        console.error('mc_getAllSchemes failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取方案详情
    ipcMain.handle('mc_getSchemeById', async (_, id) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const scheme = await MassConcreteSchemeService.getSchemeById(id)
        return { success: true, data: scheme }
      } catch (error) {
        console.error('mc_getSchemeById failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 创建方案
    ipcMain.handle('mc_createScheme', async (_, data) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const scheme = await MassConcreteSchemeService.createScheme(data)
        return { success: true, data: scheme }
      } catch (error) {
        console.error('mc_createScheme failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新方案
    ipcMain.handle('mc_updateScheme', async (_, { id, data }) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        const scheme = await MassConcreteSchemeService.updateScheme(id, data)
        return { success: true, data: scheme }
      } catch (error) {
        console.error('mc_updateScheme failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 删除方案
    ipcMain.handle('mc_deleteScheme', async (_, id) => {
      try {
        const MassConcreteSchemeService = require('../services/MassConcreteSchemeService')
        await MassConcreteSchemeService.deleteScheme(id)
        return { success: true }
      } catch (error) {
        console.error('mc_deleteScheme failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 配合比设计 ==========

    // 计算配合比（大体积混凝土版：先调用通用计算，再应用大体积限值）
    ipcMain.handle('mc_calculateMixDesign', async (_, params) => {
      try {
        // 1. 调用通用配合比设计计算
        const MixDesignService = require('../services/MixDesignService')
        const MassConcreteMixDesignService = require('../services/MassConcreteMixDesignService')

        // 从 params 中提取大体积混凝土专用参数
        const { cementHeat3d, cementHeat7d, ...mixParams } = params

        // 保存原始材料对象（包含密度信息）
        const originalMaterials = mixParams.materials

        const mixResult = await MixDesignService.calculateMixDesign(mixParams)

        // 将原始材料信息附加到结果中，供 applyLimits 使用
        mixResult.materials._materials = originalMaterials

        // 2. 应用大体积混凝土限值
        const limitedResult = MassConcreteMixDesignService.applyLimits(mixResult)

        // 3. 计算水化热（如果提供了水化热参数）
        let hydrationHeat = null
        if (cementHeat3d && cementHeat7d) {
          hydrationHeat = MassConcreteMixDesignService.calculateHydrationHeat(
            limitedResult.materials.cement,
            limitedResult.materials.flyAsh || 0,
            limitedResult.materials.slag || 0,
            cementHeat3d,
            cementHeat7d
          )
        }

        // 4. 组装最终结果
        const finalResult = {
          ...limitedResult,
          hydrationHeat,
          // 保留原始输入参数
          inputParams: params
        }

        return { success: true, data: finalResult }
      } catch (error) {
        console.error('mc_calculateMixDesign failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存配合比
    ipcMain.handle('mc_saveMixDesign', async (_, data) => {
      try {
        const MassConcreteMixDesignService = require('../services/MassConcreteMixDesignService')
        const result = await MassConcreteMixDesignService.saveMixDesign(data.schemeId, data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveMixDesign failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 从配合比导入
    ipcMain.handle('mc_importFromMixDesign', async (_, mixDesignId) => {
      try {
        const MassConcreteMixDesignService = require('../services/MassConcreteMixDesignService')
        const result = await MassConcreteMixDesignService.importFromMixDesign(mixDesignId)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_importFromMixDesign failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 原材料 ==========

    // 根据材料ID获取完整材料信息（包含水化热等）
    ipcMain.handle('mc_getMaterialById', async (_, id) => {
      try {
        const Material = require('../db/models/Material')
        const material = await Material.findByPk(id)
        return { success: true, data: material ? material.toJSON() : null }
      } catch (error) {
        console.error('mc_getMaterialById failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 根据材料ID列表批量获取材料信息
    ipcMain.handle('mc_getMaterialsByIds', async (_, ids) => {
      try {
        const Material = require('../db/models/Material')
        const materials = await Material.findAll({
          where: { id: ids }
        })
        return { success: true, data: materials.map(m => m.toJSON()) }
      } catch (error) {
        console.error('mc_getMaterialsByIds failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 绝热温升 ==========

    // 计算绝热温升
    ipcMain.handle('mc_calculateAdiabaticTemp', async (_, data) => {
      try {
        const MassConcreteAdiabaticTempService = require('../services/MassConcreteAdiabaticTempService')
        const result = await MassConcreteAdiabaticTempService.calculate(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateAdiabaticTemp failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存绝热温升
    ipcMain.handle('mc_saveAdiabaticTemp', async (_, data) => {
      try {
        const MassConcreteAdiabaticTempService = require('../services/MassConcreteAdiabaticTempService')
        const result = await MassConcreteAdiabaticTempService.saveResult(data.schemeId, data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveAdiabaticTemp failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 温度应力 ==========

    // 计算温度应力
    ipcMain.handle('mc_calculateStress', async (_, data) => {
      try {
        const MassConcreteStressService = require('../services/MassConcreteStressService')
        const result = await MassConcreteStressService.calculate(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateStress failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存温度应力
    ipcMain.handle('mc_saveStress', async (_, data) => {
      try {
        const MassConcreteStressService = require('../services/MassConcreteStressService')
        const result = await MassConcreteStressService.saveResult(data.schemeId, data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveStress failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 保温计算 ==========

    // 计算保温
    ipcMain.handle('mc_calculateInsulation', async (_, data) => {
      try {
        const MassConcreteInsulationService = require('../services/MassConcreteInsulationService')
        const result = await MassConcreteInsulationService.calculate(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateInsulation failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 保存保温
    ipcMain.handle('mc_saveInsulation', async (_, data) => {
      try {
        const MassConcreteInsulationService = require('../services/MassConcreteInsulationService')
        const result = await MassConcreteInsulationService.saveResult(data.schemeId, data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_saveInsulation failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 散热条件 ==========

    // 获取所有散热条件
    ipcMain.handle('mc_getHeatDissipationConditions', async () => {
      try {
        const conditions = await MassConcreteHeatDissipation.findAll({
          order: [['id', 'ASC']]
        })
        return { success: true, data: conditions.map(c => c.toJSON()) }
      } catch (error) {
        console.error('mc_getHeatDissipationConditions failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 创建散热条件
    ipcMain.handle('mc_createHeatDissipationCondition', async (_, data) => {
      try {
        const condition = await MassConcreteHeatDissipation.create(data)
        return { success: true, data: condition.toJSON() }
      } catch (error) {
        console.error('mc_createHeatDissipationCondition failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新散热条件
    ipcMain.handle('mc_updateHeatDissipationCondition', async (_, { id, ...updates }) => {
      try {
        const condition = await MassConcreteHeatDissipation.findByPk(id)
        if (!condition) {
          return { success: false, error: '散热条件不存在' }
        }
        await condition.update(updates)
        return { success: true, data: condition.toJSON() }
      } catch (error) {
        console.error('mc_updateHeatDissipationCondition failed:', error)
        return { success: false, error: error.message }
      }
    })

    // 删除散热条件（非默认）
    ipcMain.handle('mc_deleteHeatDissipationCondition', async (_, id) => {
      try {
        const condition = await MassConcreteHeatDissipation.findByPk(id)
        if (!condition) {
          return { success: false, error: '散热条件不存在' }
        }
        if (condition.isDefault) {
          return { success: false, error: '默认条件不能删除' }
        }
        await condition.destroy()
        return { success: true }
      } catch (error) {
        console.error('mc_deleteHeatDissipationCondition failed:', error)
        return { success: false, error: error.message }
      }
    })

    // ========== 温度场 ==========

    // 计算温度场
    ipcMain.handle('mc_calculateTemperatureField', async (_, data) => {
      try {
        const MassConcreteTemperatureFieldService = require('../services/MassConcreteTemperatureFieldService')
        const result = MassConcreteTemperatureFieldService.calculate(data)
        return { success: true, data: result }
      } catch (error) {
        console.error('mc_calculateTemperatureField failed:', error)
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MassConcreteHandler()