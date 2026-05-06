/**
 * AI配合比分析 IPC Handler
 * 处理前端发送的AI分析请求
 */

const DeepSeekService = require('../services/DeepSeekService')
const SystemService = require('../services/SystemService')
const MaterialService = require('../services/MaterialService')
const MixDesignService = require('../services/MixDesignService')
const MixDesignOptimizer = require('../services/MixDesignOptimizer')

// 从系统参数获取API密钥
const getDeepSeekApiKey = async () => {
  try {
    const result = await SystemService.getParamByName('deepseekApiKey')
    if (result && result.value) {
      return result.value
    }
    return null
  } catch (error) {
    console.error('获取DeepSeek API密钥失败:', error)
    return null
  }
}

let deepSeekService = null
let cachedApiKey = null

// 获取或创建DeepSeek服务实例
const getDeepSeekService = async () => {
  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    return null
  }
  if (!deepSeekService || cachedApiKey !== apiKey) {
    deepSeekService = new DeepSeekService(apiKey)
    cachedApiKey = apiKey
  }
  return deepSeekService
}

/**
 * 分析配合比数据
 */
const analyzeMixDesign = async (event, { data, customPrompt }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    const result = await service.analyzeMixDesign(data, customPrompt || '')
    return result
  } catch (error) {
    console.error('AI分析失败:', error)
    throw error
  }
}

/**
 * 检查API配置状态
 */
const checkApiStatus = async () => {
  const apiKey = await getDeepSeekApiKey()
  return {
    configured: !!apiKey,
    message: apiKey ? 'API已配置' : 'API未配置，请在系统设置中配置DeepSeek API密钥'
  }
}

/**
 * 执行 AI 调用的工具
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<object>} 执行结果
 */
const executeToolCall = async (toolName, args) => {
  switch (toolName) {
    case 'list_available_materials': {
      const materials = await MaterialService.getAllMaterials()
      if (args.type) {
        const filtered = materials.filter(m => m.type === args.type)
        return { success: true, count: filtered.length, materials: filtered }
      }
      return { success: true, count: materials.length, materials }
    }

    case 'calculate_mix_design': {
      const requiredParams = ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      const missing = requiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (missing.length > 0) {
        return { success: false, missingParams: missing, hint: `缺少必填参数: ${missing.join(', ')}，请向用户追问。` }
      }

      const allMaterials = await MaterialService.getAllMaterials()
      const findById = (id) => allMaterials.find(m => m.id === id)

      const materials = {}
      materials.cement = findById(args.cementId)
      if (!materials.cement) return { success: false, error: `水泥(ID=${args.cementId})不存在` }

      materials.sand = args.sandIds.map(id => {
        const m = findById(id); if (!m) throw new Error(`细骨料(ID=${id})不存在`); return m
      })
      materials.stone = args.stoneIds.map(id => {
        const m = findById(id); if (!m) throw new Error(`粗骨料(ID=${id})不存在`); return m
      })

      if (args.flyAshId) materials.flyAsh = findById(args.flyAshId)
      if (args.slagId) materials.slag = findById(args.slagId)
      if (args.lithiumSlagId) materials.lithiumSlag = findById(args.lithiumSlagId)
      if (args.compositePowderId) materials.compositePowder = findById(args.compositePowderId)
      if (args.superplasticizerId) materials.superplasticizer = findById(args.superplasticizerId)

      const result = await MixDesignService.calculateMixDesign({
        strength: args.strength,
        slump: args.slump,
        materials,
        flyAshDosage: args.flyAshDosage || 0,
        slagDosage: args.slagDosage || 0,
        lithiumSlagDosage: args.lithiumSlagDosage || 0,
        compositePowderDosage: args.compositePowderDosage || 0,
        sandRatio: args.sandRatio,
        calculationMethod: args.calculationMethod || 'absolute',
        targetDensity: args.targetDensity,
        airContent: args.airContent,
        tempSettings: args.tempSettings
      })

      return {
        success: true,
        type: 'mix_design',
        data: {
          strength: args.strength,
          slump: args.slump,
          materials: result.materials,
          materialCosts: result.materialCosts,
          totalCost: result.totalCost,
          waterRatio: result.waterRatio,
          sandRatio: result.sandRatio,
          density: result.density,
          targetStrength: result.targetStrength,
          calculationSteps: result.calculationSteps,
          fineAggregateBreakdown: result.fineAggregateBreakdown,
          coarseAggregateBreakdown: result.coarseAggregateBreakdown
        }
      }
    }

    case 'optimize_mix_cost': {
      const requiredParams = ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      const missing = requiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (missing.length > 0) {
        return { success: false, missingParams: missing, hint: `缺少必填参数: ${missing.join(', ')}` }
      }

      const allMaterials = await MaterialService.getAllMaterials()
      const findById = (id) => allMaterials.find(m => m.id === id)

      const constraints = {
        strength: args.strength,
        slump: args.slump,
        materials: {}
      }

      constraints.materials.cement = findById(args.cementId)
      constraints.materials.sand = args.sandIds.map(id => findById(id)).filter(Boolean)
      constraints.materials.stone = args.stoneIds.map(id => findById(id)).filter(Boolean)
      if (args.flyAshIds) constraints.materials.flyAsh = args.flyAshIds.map(id => findById(id)).filter(Boolean)
      if (args.slagIds) constraints.materials.slag = args.slagIds.map(id => findById(id)).filter(Boolean)
      if (args.lithiumSlagIds) constraints.materials.lithiumSlag = args.lithiumSlagIds.map(id => findById(id)).filter(Boolean)
      if (args.compositePowderIds) constraints.materials.compositePowder = args.compositePowderIds.map(id => findById(id)).filter(Boolean)
      if (args.superplasticizerIds) constraints.materials.superplasticizer = args.superplasticizerIds.map(id => findById(id)).filter(Boolean)

      const userLimits = {}
      if (args.flyAshRange) userLimits.flyAshRange = args.flyAshRange
      if (args.slagRange) userLimits.slagRange = args.slagRange
      if (args.lithiumSlagRange) userLimits.lithiumSlagRange = args.lithiumSlagRange
      if (args.compositePowderRange) userLimits.compositePowderRange = args.compositePowderRange
      if (args.gridStep) userLimits.gridStep = args.gridStep
      if (args.waterRatioRange) userLimits.waterRatioRange = args.waterRatioRange

      const optimizer = new MixDesignOptimizer()
      const result = await optimizer.optimizeMixDesign({ constraints, userLimits })

      return {
        success: true,
        type: 'optimization',
        data: {
          strength: args.strength,
          slump: args.slump,
          bestSolution: {
            materials: result.bestSolution.materials,
            materialCosts: result.bestSolution.materialCosts,
            totalCost: result.bestSolution.totalCost,
            cementitiousCost: result.bestSolution.cementitiousCost,
            waterRatio: result.bestSolution.waterRatio,
            sandRatio: result.bestSolution.sandRatio,
            density: result.bestSolution.density,
            selectedMaterials: result.bestSolution.selectedMaterials,
            params: result.bestSolution.params
          },
          alternatives: (result.alternatives || []).map(alt => ({
            materials: alt.materials,
            materialCosts: alt.materialCosts,
            totalCost: alt.totalCost,
            waterRatio: alt.waterRatio,
            sandRatio: alt.sandRatio,
            params: alt.params
          })),
          totalEvaluated: result.totalEvaluated,
          historyId: result.historyId
        }
      }
    }

    case 'compare_materials': {
      const requiredParams = ['strength', 'slump', 'compareType', 'baseParams', 'candidateIds']
      const missing = requiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (missing.length > 0) {
        return { success: false, missingParams: missing, hint: `缺少必填参数: ${missing.join(', ')}` }
      }

      const allMaterials = await MaterialService.getAllMaterials()
      const findById = (id) => allMaterials.find(m => m.id === id)
      const bp = args.baseParams

      const compareKey = ({ cement: 'cement', flyAsh: 'flyAsh', slag: 'slag', lithiumSlag: 'lithiumSlag', compositePowder: 'compositePowder', superplasticizer: 'superplasticizer', sand: 'sand', stone: 'stone' })[args.compareType]

      const buildMaterials = (candidateId) => {
        const materials = {}

        if (compareKey === 'cement') {
          materials.cement = findById(candidateId)
        } else {
          materials.cement = bp.cementId ? findById(bp.cementId) : undefined
        }

        if (compareKey === 'sand') {
          materials.sand = [findById(candidateId)].filter(Boolean)
        } else {
          materials.sand = bp.sandIds ? bp.sandIds.map(id => findById(id)).filter(Boolean) : undefined
        }

        if (compareKey === 'stone') {
          materials.stone = [findById(candidateId)].filter(Boolean)
        } else {
          materials.stone = bp.stoneIds ? bp.stoneIds.map(id => findById(id)).filter(Boolean) : undefined
        }

        if (compareKey === 'flyAsh') materials.flyAsh = findById(candidateId)
        else if (bp.flyAshId) materials.flyAsh = findById(bp.flyAshId)

        if (compareKey === 'slag') materials.slag = findById(candidateId)
        else if (bp.slagId) materials.slag = findById(bp.slagId)

        if (compareKey === 'lithiumSlag') materials.lithiumSlag = findById(candidateId)
        else if (bp.lithiumSlagId) materials.lithiumSlag = findById(bp.lithiumSlagId)

        if (compareKey === 'compositePowder') materials.compositePowder = findById(candidateId)
        else if (bp.compositePowderId) materials.compositePowder = findById(bp.compositePowderId)

        if (compareKey === 'superplasticizer') materials.superplasticizer = findById(candidateId)
        else if (bp.superplasticizerId) materials.superplasticizer = findById(bp.superplasticizerId)

        return materials
      }

      const results = []
      for (const candidateId of args.candidateIds) {
        const materials = buildMaterials(candidateId)
        const result = await MixDesignService.calculateMixDesign({
          strength: args.strength,
          slump: args.slump,
          materials,
          flyAshDosage: bp.flyAshDosage || 0,
          slagDosage: bp.slagDosage || 0,
          lithiumSlagDosage: bp.lithiumSlagDosage || 0,
          compositePowderDosage: bp.compositePowderDosage || 0,
          sandRatio: bp.sandRatio,
          calculationMethod: bp.calculationMethod || 'absolute'
        })
        const candidateMaterial = findById(candidateId)
        results.push({
          materialId: candidateId,
          materialName: candidateMaterial?.name || `ID=${candidateId}`,
          targetStrength: result.targetStrength,
          totalCost: result.totalCost,
          waterRatio: result.waterRatio,
          sandRatio: result.sandRatio,
          cementitiousAmount: (result.materials?.cement || 0) + (result.materials?.flyAsh || 0) + (result.materials?.slag || 0) + (result.materials?.lithiumSlag || 0) + (result.materials?.compositePowder || 0)
        })
      }

      return { success: true, type: 'material_compare', data: { compareType: args.compareType, results } }
    }

    default:
      return { success: false, error: `未知工具: ${toolName}` }
  }
}

/**
 * 与AI对话
 */
const chatWithAI = async (event, { message, context }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    const result = await service.chat(message, context, {
      toolExecutor: executeToolCall
    })
    return result
  } catch (error) {
    console.error('AI对话失败:', error)
    throw error
  }
}

/**
 * 清空对话历史
 */
const clearChatHistory = async () => {
  const service = await getDeepSeekService()
  if (service) {
    service.clearHistory()
  }
  return { success: true }
}

/**
 * 注册IPC处理器
 */
const registerHandlers = (ipcMain) => {
  ipcMain.handle('aiAnalysis:analyze', analyzeMixDesign)
  ipcMain.handle('aiAnalysis:checkStatus', checkApiStatus)
  ipcMain.handle('aiAnalysis:chat', chatWithAI)
  ipcMain.handle('aiAnalysis:clearHistory', clearChatHistory)
  console.log('AI Analysis IPC handlers registered')
}

// 自动注册处理器
const { ipcMain } = require('electron')
registerHandlers(ipcMain)

module.exports = {
  register: registerHandlers,
  analyzeMixDesign,
  checkApiStatus,
  chatWithAI,
  clearChatHistory
}
