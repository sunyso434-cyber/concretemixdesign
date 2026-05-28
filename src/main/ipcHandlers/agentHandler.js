const { ipcMain } = require('electron')
const DeepSeekService = require('../services/DeepSeekService')
const AgentOrchestrator = require('../agent/AgentOrchestrator')
const ToolRegistry = require('../agent/ToolRegistry')
const SharedSchemas = require('../agent/SharedSchemas')
const agentMemoryService = require('../services/AgentMemoryService')
const SystemService = require('../services/SystemService')

// 缓存实例
let orchestrator = null
let toolRegistry = null
let cachedApiKey = null

const getDeepSeekApiKey = async () => {
  try {
    const result = await SystemService.getParamByName('deepseekApiKey')
    return result?.value || null
  } catch (_) {
    return null
  }
}

async function getOrchestrator() {
  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) return null

  if (!toolRegistry || !orchestrator || cachedApiKey !== apiKey) {
    const ds = new DeepSeekService(apiKey)

    // 构建 ToolRegistry 并注册所有工具
    toolRegistry = new ToolRegistry()
    registerTools(toolRegistry)

    orchestrator = new AgentOrchestrator({
      deepseekService: ds,
      toolRegistry
    })
    cachedApiKey = apiKey
  }

  return orchestrator
}

function registerTools(registry) {
  // 所有复杂工具通过 callLegacyTool 复用 aiAnalysisHandler.executeToolCall

  registry.register({
    name: 'list_available_materials',
    description: '查询材料库中可用的原材料列表',
    parameters: { ...SharedSchemas.materialQuery },
    handler: async (args) => callLegacyTool('list_available_materials', args)
  })

  registry.register({
    name: 'calculate_mix_design',
    description: '根据给定参数计算混凝土配合比。支持水泥、粉煤灰、矿渣粉、锂渣、复合粉、减水剂等全部材料类型。',
    parameters: {
      strength: { type: 'string', description: '强度等级，如 C30' },
      slump: { type: 'number', description: '坍落度(mm)' },
      cementId: { type: 'integer' },
      sandIds: { type: 'array', items: { type: 'integer' } },
      stoneIds: { type: 'array', items: { type: 'integer' } },
      flyAshId: { type: 'integer' },
      slagId: { type: 'integer' },
      lithiumSlagId: { type: 'integer' },
      compositePowderId: { type: 'integer' },
      superplasticizerId: { type: 'integer' },
      flyAshDosage: { type: 'number' },
      slagDosage: { type: 'number' },
      lithiumSlagDosage: { type: 'number' },
      compositePowderDosage: { type: 'number' },
      sandRatio: { type: 'number' },
      ...SharedSchemas.tempSettings.properties || {}
    },
    handler: async (args) => callLegacyTool('calculate_mix_design', args)
  })

  // 对于复杂工具，直接复用 aiAnalysisHandler 的 executeToolCall
  const { executeToolCall } = require('./aiAnalysisHandler')

  const callLegacyTool = async (toolName, args) => {
    if (executeToolCall) {
      return executeToolCall(toolName, args)
    }
    return { success: false, error: `工具 ${toolName} 未配置` }
  }

  registry.register({
    name: 'optimize_mix_cost',
    description: '对给定材料和约束条件执行网格搜索，找出成本最低的混凝土配合比方案。支持所有掺合料类型（粉煤灰、矿渣粉、锂渣、复合粉）和减水剂。',
    parameters: {
      strength: { type: 'string', description: '强度等级' },
      slump: { type: 'number', description: '坍落度(mm)' },
      cementId: { type: 'integer' },
      sandIds: { type: 'array', items: { type: 'integer' } },
      stoneIds: { type: 'array', items: { type: 'integer' } },
      flyAshIds: { type: 'array', items: { type: 'integer' }, description: '粉煤灰候选ID列表' },
      slagIds: { type: 'array', items: { type: 'integer' }, description: '矿渣粉候选ID列表' },
      lithiumSlagIds: { type: 'array', items: { type: 'integer' }, description: '锂渣候选ID列表' },
      compositePowderIds: { type: 'array', items: { type: 'integer' }, description: '复合粉候选ID列表' },
      superplasticizerIds: { type: 'array', items: { type: 'integer' }, description: '减水剂候选ID列表' },
      flyAshRange: { type: 'array', items: { type: 'number' }, description: '粉煤灰掺量范围 [min, max]' },
      slagRange: { type: 'array', items: { type: 'number' }, description: '矿渣粉掺量范围 [min, max]' },
      lithiumSlagRange: { type: 'array', items: { type: 'number' }, description: '锂渣掺量范围 [min, max]' },
      compositePowderRange: { type: 'array', items: { type: 'number' }, description: '复合粉掺量范围 [min, max]' },
      gridStep: { type: 'number', description: '网格搜索步长，默认5' },
      ...SharedSchemas.tempSettings.properties || {}
    },
    handler: async (args) => callLegacyTool('optimize_mix_cost', args)
  })

  registry.register({
    name: 'compare_materials',
    description: '对比不同材料对配合比结果的影响',
    parameters: {
      strength: { type: 'string' },
      slump: { type: 'number' },
      compareType: { type: 'string' },
      baseParams: { type: 'object' },
      candidateIds: { type: 'array', items: { type: 'integer' } }
    },
    handler: async (args) => callLegacyTool('compare_materials', args)
  })

  registry.register({
    name: 'predict_performance',
    description: '基于XGBoost模型预测混凝土性能',
    parameters: {
      cementId: { type: 'integer' },
      sandId: { type: 'integer' },
      stoneId: { type: 'integer' }
    },
    handler: async (args) => callLegacyTool('predict_performance', args)
  })

  registry.register({
    name: 'check_compliance',
    description: '审查混凝土配合比是否符合规范要求',
    parameters: {
      mixDesign: { type: 'object' }
    },
    handler: async (args) => callLegacyTool('check_compliance', args)
  })

  registry.register({
    name: 'list_standards',
    description: '列出已加载的规范知识库',
    parameters: { category: { type: 'string' } },
    handler: async (args) => callLegacyTool('list_standards', args)
  })

  registry.register({
    name: 'run_parameter_diagnosis',
    description: '对上传的配合比数据执行参数诊断',
    parameters: {},
    handler: async (args) => callLegacyTool('run_parameter_diagnosis', args)
  })

  registry.register({
    name: 'prepare_sales_quote_draft',
    description: '根据强度等级返回销售报价草稿',
    parameters: {
      strengthGrade: { type: 'string' },
      concreteType: { type: 'string' },
      slump: { type: 'number' }
    },
    handler: async (args) => callLegacyTool('prepare_sales_quote_draft', args)
  })

  registry.register({
    name: 'calculate_sales_quote',
    description: '生成混凝土销售报价',
    parameters: {
      basicMixId: { type: 'integer' },
      pricing: { type: 'object' }
    },
    handler: async (args) => callLegacyTool('calculate_sales_quote', args)
  })

  registry.register({
    name: 'save_mix_design',
    description: '保存配合比方案',
    parameters: { name: { type: 'string' }, projectName: { type: 'string' } },
    handler: async (args) => callLegacyTool('save_mix_design', args),
    requiresConfirmation: true
  })

  registry.register({
    name: 'save_to_basic_mix_library',
    description: '保存到基础配合比库',
    parameters: { name: { type: 'string' }, strengthGrade: { type: 'string' } },
    handler: async (args) => callLegacyTool('save_to_basic_mix_library', args),
    requiresConfirmation: true
  })
}

// 注册 IPC 处理器
function registerAgentHandlers() {
  ipcMain.handle('agent:run', async (event, { requestId, sessionId, message, mode }) => {
    const ag = await getOrchestrator()
    if (!ag) {
      return { success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' }
    }

    // Agent 通过 agent:progress 事件自行推送进度到 renderer
    try {
      const result = await ag.run({ sessionId, message, mode: mode || 'auto', webContents: event.sender })
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('agent:pause', async (_event, { requestId }) => {
    if (orchestrator) orchestrator.pause()
    return { success: true }
  })

  ipcMain.handle('agent:resume', async (_event, { requestId }) => {
    if (orchestrator) orchestrator.resume()
    return { success: true }
  })

  ipcMain.handle('agent:abort', async (_event, { requestId }) => {
    if (orchestrator) orchestrator.abort()
    return { success: true }
  })

  ipcMain.handle('agent:confirm', async (_event, { confirmed, args }) => {
    if (orchestrator) {
      orchestrator.resolveConfirmation(confirmed, args)
    }
    return { success: true }
  })

  ipcMain.handle('agent:listSessions', async () => {
    const sessions = await agentMemoryService.getSessionIds(20)
    return { success: true, sessions }
  })

  ipcMain.handle('agent:getSessionMessages', async (_event, { sessionId }) => {
    const messages = await agentMemoryService.getHistory(sessionId, { limit: 100 })
    return { success: true, messages }
  })

  ipcMain.handle('agent:deleteSession', async (_event, { sessionId }) => {
    await agentMemoryService.deleteSession(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:getPreferences', async () => {
    const prefs = await agentMemoryService.getAllPreferences()
    return { success: true, preferences: prefs }
  })

  ipcMain.handle('agent:getCorrections', async () => {
    const rules = await agentMemoryService.getAllCorrections()
    return { success: true, corrections: rules.map(r => ({
      id: r.id,
      context: r.context,
      originalSuggestion: r.originalSuggestion,
      userCorrection: r.userCorrection,
      toolName: r.toolName,
      createdAt: r.createdAt
    })) }
  })

  ipcMain.handle('agent:deleteCorrection', async (_event, { id }) => {
    await agentMemoryService.deleteCorrection(id)
    return { success: true }
  })

  ipcMain.handle('agent:clearAllMemory', async () => {
    const { ChatHistory, UserPreference, CorrectionRule } = require('../db/database')
    await ChatHistory.destroy({ where: {}, truncate: true })
    await UserPreference.destroy({ where: {}, truncate: true })
    await CorrectionRule.destroy({ where: {}, truncate: true })
    return { success: true }
  })
}

module.exports = { registerAgentHandlers }
