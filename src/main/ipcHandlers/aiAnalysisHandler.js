/**
 * AI配合比分析 IPC Handler
 * 处理前端发送的AI分析请求
 */

const DeepSeekService = require('../services/DeepSeekService')
const { classifyError } = require('../agent/errorClassifier')
const { tryWithFailover } = require('../services/llmFailover')
const SystemService = require('../services/SystemService')
const MaterialService = require('../services/MaterialService')
const MixDesignService = require('../services/MixDesignService/index')
const MixDesignOptimizer = require('../services/MixDesignOptimizer')
const AnalysisClassifier = require('../services/AnalysisClassifier')
const AnalysisPreprocessor = require('../services/AnalysisPreprocessor')
const SalesQuoteCalculationService = require('../services/SalesQuoteCalculationService')
const SalesQuoteToolGuard = require('../services/SalesQuoteToolGuard')
const { Material } = require('../db/database')

let deepSeekService = null
let cachedConfigId = null
const CHAT_STREAM_EVENT = 'aiAnalysis:chatStream:event'

// 默认的 getDeepSeekService 实现：从 LLM 配置管理器懒加载
const defaultGetDeepSeekService = async () => {
  const activeConfig = await SystemService.getActiveLlmConfig()
  if (!activeConfig || !activeConfig.apiKey) {
    return null
  }
  if (!deepSeekService || cachedConfigId !== activeConfig.id) {
    deepSeekService = new DeepSeekService(activeConfig, SystemService)
    cachedConfigId = activeConfig.id
  }
  return deepSeekService
}

// 允许通过依赖注入覆盖（测试用）。生产代码无需关心。
let getDeepSeekService = defaultGetDeepSeekService

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
  if (SalesQuoteToolGuard.shouldBlockTool(toolName, args._salesQuoteGuard)) {
    return SalesQuoteToolGuard.buildBlockedToolResult(toolName)
  }

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

      const mixDesignResult = {
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
          coarseAggregateBreakdown: result.coarseAggregateBreakdown,
          selectedMaterials: materials
        }
      }
      return mixDesignResult
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

      if (args.tempSettings) {
        constraints.tempSettings = args.tempSettings
      }

      const optimizer = new MixDesignOptimizer()
      const result = await optimizer.optimizeMixDesign({ constraints, userLimits })

      const optimizeResult = {
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
            selectedMaterials: {
              cement: constraints.materials.cement,
              sand: constraints.materials.sand,
              stone: constraints.materials.stone,
              ...(result.bestSolution.selectedMaterials || {})
            },
            fineAggregateBreakdown: result.bestSolution.fineAggregateBreakdown,
            coarseAggregateBreakdown: result.bestSolution.coarseAggregateBreakdown,
            calculationSteps: result.bestSolution.calculationSteps,
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
      return optimizeResult
    }

    case 'predict_performance': {
      const XGBoostPredictionService = require('../services/XGBoostPredictionService')
      const MixFormatConverter = require('../services/MixFormatConverter')
      const predRequiredParams = ['cementId', 'sandId', 'stoneId']
      const predMissing = predRequiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (predMissing.length > 0) {
        return { success: false, missingParams: predMissing, hint: `缺少必填参数: ${predMissing.join(', ')}，请向用户追问。` }
      }
      // 如果传入配合比计算结果的 materials 格式，自动转换为模型所需参数格式
      if (args.materials && !args.cementAmount) {
        const converted = MixFormatConverter.mixDesignResultToPredictionInput(args)
        args = { ...args, ...converted }
      }
      return await XGBoostPredictionService.predict(args)
    }

    case 'prepare_sales_quote_draft': {
      // v10.10 已废弃: 草稿模式被 reverse/forward 模式替代,规则表/基准库干掉
      return {
        success: false,
        error: 'prepare_sales_quote_draft 已废弃(v10.10)。请直接调用 reverse_sales_quote (按市价反推) 或 forward_sales_quote (正向议价测算) 即可,这两个 Skill 自带默认值。'
      }
    }

    case 'calculate_sales_quote': {
      // v10.10 已废弃: 基准配合比库 BasicMixDesign 干掉,基础算法被 calculateReverse/calculateForward 替代
      return {
        success: false,
        error: 'calculate_sales_quote 已废弃(v10.10)。请使用 reverse_sales_quote (按市价反推) 或 forward_sales_quote (正向议价测算)。'
      }
    }

    case 'save_mix_design': {
      // 从方案ID确认方案（新逻辑：草稿确认模式）
      if (args.schemeId) {
        try {
          const existing = await MixDesignService.getMixDesignById(args.schemeId)
          if (!existing) {
            return { success: false, error: `方案ID ${args.schemeId} 不存在` }
          }
          const updateData = { status: '已确认' }
          if (args.name) updateData.name = args.name
          if (args.projectName) updateData.projectName = args.projectName
          await MixDesignService.updateMixDesign(args.schemeId, updateData)
          return { success: true, type: 'save_result', message: `方案「${args.name || existing.name}」已确认保存`, id: args.schemeId }
        } catch (err) {
          return { success: false, error: `确认失败: ${err.message}` }
        }
      }
      // 兼容旧路径：如果没有schemeId，尝试从方案库取最近的草稿确认
      try {
        const drafts = await MixDesignService.getAllMixDesigns({ onlyDrafts: true })
        if (drafts && drafts.length > 0) {
          const latest = drafts[0]
          const updateData = { status: '已确认' }
          if (args.name) updateData.name = args.name
          if (args.projectName) updateData.projectName = args.projectName
          await MixDesignService.updateMixDesign(latest.id, updateData)
          return { success: true, type: 'save_result', message: `方案「${args.name || latest.name}」已确认保存`, id: latest.id }
        }
      } catch (e) {
        console.warn('[save_mix_design] 兼容路径失败:', e.message)
      }
      return { success: false, error: '没有可保存的配合比方案。请先执行配合比计算。' }
    }

    case 'save_to_basic_mix_library': {
      // v10.10.2 已废弃: 基准配合比库 BasicMixDesign 整体下线（被 reverse/forward_sales_quote 替代）
      return {
        success: false,
        error: 'save_to_basic_mix_library 已废弃(v10.10.2)。基准配合比库已下线，请用 save_mix_design 保存到方案库即可。'
      }
    }

    case 'create_sales_quote_rule': {
      // v10.10 已废弃: 规则表 SalesQuoteRule 整体干掉,改用 reverse/forward Skill 内置默认值
      return {
        success: false,
        error: 'create_sales_quote_rule 已废弃(v10.10)。请使用 reverse_sales_quote / forward_sales_quote 自带的 fixedFees 参数,或在配置里直接维护默认值。'
      }
    }

    default:
      return { success: false, error: `未知工具: ${toolName}` }
  }
}

/**
 * 创建工具执行器（优先使用 SkillExecutor）
 * @param {string} message - 用户消息
 * @param {object} context - 上下文
 * @returns {Function} 工具执行函数
 */
const createToolExecutor = (message, context) => {
  const skillExecutor = DeepSeekService.getSkillExecutor()

  // 如果有 SkillExecutor，使用它
  if (skillExecutor) {
    return async (toolName, args) => {
      // 注入额外上下文
      const enrichedArgs = { ...args }
      enrichedArgs._salesQuoteGuard = {
        isSalesQuoteIntent: SalesQuoteToolGuard.isSalesQuoteIntent(message),
        userApprovedMixDesignForQuote: SalesQuoteToolGuard.hasExplicitMixDesignAuthorization(message)
      }
      if (context && context.mixDesigns) {
        enrichedArgs._mixDesigns = context.mixDesigns
      }

      // 使用 SkillExecutor 执行
      return skillExecutor.execute(toolName, enrichedArgs)
    }
  }

  // 否则使用旧的 executeToolCall
  return (toolName, args) => {
    const enrichedArgs = { ...args }
    enrichedArgs._salesQuoteGuard = {
      isSalesQuoteIntent: SalesQuoteToolGuard.isSalesQuoteIntent(message),
      userApprovedMixDesignForQuote: SalesQuoteToolGuard.hasExplicitMixDesignAuthorization(message)
    }
    if (context && context.mixDesigns) {
      enrichedArgs._mixDesigns = context.mixDesigns
    }
    return executeToolCall(toolName, enrichedArgs)
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
    const toolExecutor = createToolExecutor(message, context)
    const result = await service.chat(message, context, {
      toolExecutor
    })
    return result
  } catch (error) {
    console.error('AI对话失败:', error)
    throw error
  }
}

const chatWithAIStream = async (event, { requestId, message, context }) => {
  const configs = await SystemService.getLlmConfigs()
  if (configs.length === 0) {
    throw new Error('未配置 LLM，请在设置中添加')
  }

  // v11.7.9: 获取激活配置 ID，传入 failover 确保激活模型优先尝试
  const activeConfig = await SystemService.getActiveLlmConfig()
  const activeId = activeConfig?.id || null

  const sendStreamEvent = (payload) => {
    event.sender.send(CHAT_STREAM_EVENT, {
      requestId,
      ...payload
    })
  }

  const toolExecutor = createToolExecutor(message, context)

  try {
    const { result } = await tryWithFailover(
      configs,
      async (config) => {
        // v8.4.2：每次尝试新建一个临时 DeepSeekService（不走全局单例缓存）
        // 因为不同 config 的 apiKey/baseUrl/model 都不同
        const service = new DeepSeekService(config, SystemService)
        return service.chatStream(message, context, {
          toolExecutor,
          onEvent: sendStreamEvent
        })
      },
      (fromName, toName, reason) => {
        sendStreamEvent({
          type: 'model_switched',
          from: fromName,
          to: toName,
          reason,
        })
      },
      { activeId }  // v11.7.9: 激活模型优先
    )

    // v8.4.x：流式结束后下发真实 token 用量（DeepSeek 最后一个 chunk 会带 usage 字段）。
    // 渲染端 contextStats 用于校准 token 显示比例。
    // v8.4.2：同时下发 contextLimit，让前端圆环按当前模型的实际上下文上限计算百分比
    if (result && result.usage) {
      const u = result.usage
      const realTokens = (u.prompt_tokens || 0) + (u.completion_tokens || 0) || u.total_tokens || 0
      sendStreamEvent({
        type: 'usage',
        realTokens,
        usage: u,
        contextLimit: result.contextLimit || 800000,
      })
    }

    sendStreamEvent({ type: 'done', result })
    return result
  } catch (error) {
    const errMsg = error.message || (error.code ? `[${error.code}] ${error.title || ''}` : 'AI 对话失败')
    sendStreamEvent({ type: 'error', error: errMsg })
    console.error('AI流式对话失败:', error)
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
 * 分析预处理：识别分析类型 + 数值预处理
 */
const prepareAnalysis = async (event, { data, customPrompt, selectedContrastMaterials }) => {
  const mixDesigns = data.mixDesigns || []
  const materialMapping = data.materialMapping || {}

  if (mixDesigns.length < 2) {
    return { modes: [], preprocessedData: null }
  }

  const classifier = new AnalysisClassifier()
  const classification = classifier.classify(mixDesigns, materialMapping, customPrompt || '', {
    selectedContrastMaterials
  })

  let preprocessedData = null
  if (classification.modes.length > 0) {
    const preprocessor = new AnalysisPreprocessor()
    preprocessedData = await preprocessor.preprocess(classification, mixDesigns, materialMapping)
  }

  return {
    modes: classification.modes,
    param_trend: classification.param_trend,
    material_contrast: classification.material_contrast,
    preprocessedData
  }
}

/**
 * 注册IPC处理器
 * @param {object} [deps] - 依赖注入（测试用）
 * @param {Function} [deps.getDeepSeekService] - 自定义 getDeepSeekService（覆盖默认懒加载实现）
 * @param {object} [deps.ipcMain] - 自定义 ipcMain（测试时可注入 mock）。默认从 electron 取
 */
const registerAiAnalysisHandlers = (deps = {}) => {
  if (typeof deps.getDeepSeekService === 'function') {
    getDeepSeekService = deps.getDeepSeekService
  }
  const targetIpcMain = deps.ipcMain || require('electron').ipcMain

  targetIpcMain.handle('aiAnalysis:analyze', async () => {
    throw new Error('aiAnalysis:analyze 已废弃（v10.5.0 移除智能解析模块），请使用 calculate_mix_design / list_available_materials 等工具')
  })
  targetIpcMain.handle('analysis:prepare', prepareAnalysis)
  targetIpcMain.handle('aiAnalysis:checkStatus', checkApiStatus)
  targetIpcMain.handle('aiAnalysis:chat', chatWithAI)
  targetIpcMain.handle('aiAnalysis:chatStream', chatWithAIStream)
  targetIpcMain.handle('aiAnalysis:clearHistory', clearChatHistory)

  // ===== 上下文压缩（v8.4.x 新增 / v8.4.2 failover） =====
  // 渲染端 handleCompressContextImpl 通过 aiAnalysis:compressContext 调用。
  // 返回 {success, data: {summary, recentMessages, realTokens}} 或 {success: false, error}。
  // v8.4.2：接入 tryWithFailover，压缩失败时自动切换备用模型重试
  targetIpcMain.handle('aiAnalysis:compressContext', async (event, { messages, previousSummary }) => {
    try {
      const configs = await SystemService.getLlmConfigs()
      if (configs.length === 0) {
        return { success: false, error: '未配置 LLM，请在设置中添加' }
      }

      // v11.7.9: 激活配置优先
      const activeConfig = await SystemService.getActiveLlmConfig()
      const activeId = activeConfig?.id || null

      const { result: data } = await tryWithFailover(
        configs,
        async (config) => {
          const service = new DeepSeekService(config, SystemService)
          return service.compressContext(messages || [], previousSummary || '')
        },
        null,  // 压缩不需要通知前端切换（静默切换）
        { activeId }  // v11.7.9: 激活模型优先
      )
      return { success: true, data }
    } catch (error) {
      console.error('[aiAnalysis:compressContext] failed:', error)
      return { success: false, error: error.message || error.title || '压缩失败' }
    }
  })

  // P3 commit 2: 流式聊天错误路径 — 渲染端 catch 块回传原始错误，主进程分类后下发
  targetIpcMain.handle('aiAnalysis:chatStream:reportError', async (event, { sessionId, requestId, rawErrorMessage, rawErrorStack }) => {
    try {
      const classified = classifyError(
        { message: rawErrorMessage || 'unknown', stack: rawErrorStack },
        { callSite: 'aiAnalysis:chatStream:reportError', sessionId, requestId }
      )
      event.sender.send(CHAT_STREAM_EVENT, {
        type: 'error',
        error: classified,
        sessionId,
        requestId,
      })
      return { success: true }
    } catch (innerErr) {
      const fallback = classifyError(innerErr, { callSite: 'aiAnalysis:chatStream:reportError.fallback' })
      event.sender.send(CHAT_STREAM_EVENT, {
        type: 'error',
        error: fallback,
        sessionId,
        requestId,
      })
      return { success: false }
    }
  })

  console.log('AI Analysis IPC handlers registered')
}

// 自动注册处理器（生产环境）。测试可通过 deps.ipcMain 注入 mock。
if (process.env.NODE_ENV !== 'test') {
  const { ipcMain } = require('electron')
  registerAiAnalysisHandlers({ ipcMain })
}

module.exports = {
  register: registerAiAnalysisHandlers,
  registerAiAnalysisHandlers,
  checkApiStatus,
  chatWithAI,
  chatWithAIStream,
  clearChatHistory,
  executeToolCall
}
