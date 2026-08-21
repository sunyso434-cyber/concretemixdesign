// agentHandler - IPC 处理入口（agent 相关所有 IPC 的注册编排）
//
// 拆分说明（优化项 2，行为不变）：
// - 运行控制 + Todo 计划 IPC → ./agentRunIpc（registerAgentRunIpc）
// - 会话管理 IPC → ./sessionIpc（registerSessionIpc）
// - 技能管理 + 调试 IPC → ./skillIpc（registerSkillIpc）
// - 偏好建议 IPC → ./preferenceIpc（registerPreferenceIpc）
// 本文件保留：实例状态（skillRegistry/skillExecutor 等）、Skill 系统初始化、
// Orchestrator 获取、registerAgentHandlers 编排、对外导出签名。
// 顺带清理：getSuggestionStore / 模块级 LearningService / PreferenceSuggestion 等
// 已被搬移域使用的死 require（核实无其他引用）。

const { ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const { createAsyncLogWriter } = require('../utils/asyncLogWriter')
const _logFile = path.join(os.homedir(), '.concrete-mixdesign', 'agent-debug.log')
// 异步批量写入（300ms 合并落盘，退出前由 main.js before-quit 调 flushAll 兜底）
const _logWriter = createAsyncLogWriter(_logFile)
function _log(msg) {
  _logWriter.append(`[${new Date().toISOString()}] ${msg}\n`)
  console.log(msg)
}
// context.logger 契约是「对象带 info/error 方法」(_createLogger 形状)；裸函数 _log 会导致 skill 里 logger?.info 炸
const _logLogger = { info: _log, error: _log }
const DeepSeekService = require('../services/DeepSeekService')
const Orchestrator = require('../agent/Orchestrator')
const SkillRegistry = require('../agent/SkillRegistry')
const SkillExecutor = require('../agent/SkillExecutor')
const DynamicContextProvider = require('../agent/DynamicContextProvider')
const SkillDebugger = require('../agent/SkillDebugger')
const { buildWorkspaceSkills } = require('../agent/workspaceTools')
const agentMemoryService = require('../services/AgentMemoryService')
const SystemService = require('../services/SystemService')

// 缓存实例（Skill 系统全局共享，无状态安全）
let skillRegistry = null
let skillExecutor = null
let skillDebugger = null
let cachedActiveConfigId = null

// M0-2：会话锁 / Orchestrator / 控制逻辑委托给共享执行模块 agentExecutor（行为等价，桌面零变化）。
// 每会话独立的 Orchestrator 实例（多会话并行）与 2 分钟锁超时（spec 8.2）已移至 executor 内部。
const { createAgentExecutor } = require('../agent/agentExecutor')
const executor = createAgentExecutor({ getOrchestratorForSession, getOrchestrator })
// M0-2 + R11(P1-1)：executor 的默认 sink 可切到共享 FanoutSink（agentHandler 未调用 setFanout 时仍走 event.sender）
let executorDefaultSink = null
function setFanout(fanout) { executorDefaultSink = fanout }

// 兼容旧代码引用的全局 orchestrator（取最近一次创建的实例，仅供 getOrchestrator 内部使用）
let orchestrator = null

const { getInstance: getAgentMdService } = require('../agent/agentMd')

// 拆分出的 IPC 注册模块（优化项 2）
const { registerAgentRunIpc } = require('./agentRunIpc')
const { registerSessionIpc } = require('./sessionIpc')
const { registerSkillIpc } = require('./skillIpc')
const { registerPreferenceIpc } = require('./preferenceIpc')

// v2 adapter: read sections as v1-compatible object + write-back to v2 sections
function v2ToV1Proxy(parsed) {
  const sections = parsed.sections || []
  // helpers to find-or-create nested structure
  function ensureSection(title) {
    let sec = sections.find(s => s.title === title)
    if (!sec) { sec = { title, subSections: [] }; sections.push(sec) }
    return sec
  }
  function ensureSubSection(sectionTitle, subTitle) {
    const sec = ensureSection(sectionTitle)
    let sub = sec.subSections.find(s => s.title === subTitle)
    if (!sub) { sub = { title: subTitle, items: [], rawText: '' }; sec.subSections.push(sub) }
    return sub
  }
  // Create a persistent professionalPrefs object with mutable materials/method that sync back
  const _prefs = {}
  const bizSection = sections.find(s => s.title === '业务规则')
  const subs = (bizSection?.subSections) || []
  let _materials = (subs.find(s => s.title === '材料')?.items || []).map(v => ({ category: '', dimension: '', value: v }))
  const methodSub = subs.find(s => s.title === '计算方法')
  let _method = methodSub?.items?.[0] || null
  Object.defineProperty(_prefs, 'materials', {
    get() { return _materials },
    set(v) {
      _materials = v
      const sub = ensureSubSection('业务规则', '材料')
      sub.items = (v || []).map(m => [m.category, m.dimension, m.value].filter(Boolean).join(' '))
    },
    enumerable: true, configurable: true
  })
  Object.defineProperty(_prefs, 'method', {
    get() { return _method },
    set(v) {
      _method = v
      if (v) { const sub = ensureSubSection('业务规则', '计算方法'); sub.items = [v] }
    },
    enumerable: true, configurable: true
  })
  return {
    version: parsed.version,
    replyStyle: {},
    get professionalPrefs() { return _prefs },
    set professionalPrefs(v) {
      if (!v) return
      _prefs.materials = v.materials || []
      _prefs.method = v.method || null
    },
    get ignoredSuggestionTypes() {
      const bizSection = sections.find(s => s.title === '业务规则')
      const subs = (bizSection?.subSections) || []
      const ignoredSub = subs.find(s => s.title === '忽略的建议类型')
      return ignoredSub?.items || []
    },
    set ignoredSuggestionTypes(v) {
      const sub = ensureSubSection('业务规则', '忽略的建议类型')
      sub.items = v || []
    },
    get workflow() { return sections.filter(s => s.title !== '业务规则' && s.title !== '回复规范').map(s => s.title) },
    get customKnowledge() { return [] },
    get unknownSections() { return {} }
  }
}

/**
 * v1.5.3 Task 4.1：注册 7 个 workspace 伪 Skill。
 *
 * 关键设计：buildWorkspaceSkills 的 invoke 闭包在 execute 时才读
 * global.workspaceManager / global.wikiEngine / global.kgExtractor，所以
 * 即使本函数在 main.js workspace 初始化之前被调也安全——execute 实际被
 * LLM 触发的时机远在 workspace ready 之后。
 *
 * 幂等：多次调用只会替换同名 skill（SkillRegistry 不去重，重复注册会覆盖）。
 */
function registerWorkspacePseudoSkills() {
  if (!skillRegistry) return
  const skills = buildWorkspaceSkills({
    workspaceManager: global.workspaceManager || null,
    wikiEngine: global.wikiEngine || null,
    kgExtractor: global.kgExtractor || null
  })
  for (const s of skills) {
    skillRegistry.register(s, { builtin: true, filePath: '<workspace-pseudo>' })
  }
  console.log(`[AgentHandler] 已注册 ${skills.length} 个 workspace 伪 Skill`)
}

// 初始化 Skill 系统（应用启动时调用）
async function initSkillSystem() {
  if (skillRegistry) return skillRegistry

  console.log('[AgentHandler] 初始化 Skill 系统...')
  skillRegistry = new SkillRegistry()
  await skillRegistry.discover()

  // v1.5.3 Task 4.1：注册 7 个 workspace 伪 Skill（早期注册，闭包里的
  // global.* 引用在 execute 时才真正求值，避免 init 时序问题）。
  // 真正的执行转发由各 invoke 闭包在运行时读 global.workspaceManager /
  // global.wikiEngine / global.kgExtractor，确保 main.js 完成 workspace 初始化
  // 之后才能正确调用。
  registerWorkspacePseudoSkills()

  // P1-1: 注册 recall_session 内置 skill（FTS5 记忆检索）
  try {
    const recallSkill = require('../agent/skills/recallSession')
    skillRegistry.register(recallSkill, { builtin: true, filePath: '<builtin>' })
    console.log('[AgentHandler] 已注册 recall_session skill')
  } catch (err) {
    console.warn('[AgentHandler] 注册 recall_session 失败:', err.message)
  }

  // 设置 DeepSeekService 的 SkillRegistry
  DeepSeekService.setSkillRegistry(skillRegistry)

  // 创建 DynamicContextProvider（按需注入服务，节省token）
  // v1.5.3 Task 4.2：额外注入 wiki/workspace/chatHistory 到 allServices，
  // 让 18 个 Skill 可选地通过 context.wiki / context.workspace / context.chatHistory
  // 访问 workspace 能力（不改 Skill 的 execute(args, context) 签名）。
  // 来源是 global.*：main.js 在 workspace 初始化时已挂到 global。
  // P1 阶段 global.* 可能为 null → DynamicContextProvider.getServices 内部
  // `if (this.allServices[serviceName])` 跳过 null，不抛错。
  const allServices = {
    materialService: require('../services/MaterialService'),
    mixDesignService: require('../services/MixDesignService'),
    mixDesignOptimizer: require('../services/MixDesignOptimizer'),
    salesQuoteCalculation: require('../services/SalesQuoteCalculationService'),
    salesQuoteHistory: require('../services/SalesQuoteHistoryService'),
    xgboostPrediction: require('../services/XGBoostPredictionService'),
    trialTestService: require('../services/TrialTestService'),
    materialBatchService: require('../services/MaterialBatchService'),
    auditLogService: require('../services/AuditLogService'),

    // === v0.8.0 Task 13：生产供应计划 services 注入 ===
    capacityConfigService: require('../services/CapacityConfigService'),
    projectDistanceService: require('../services/ProjectDistanceService'),
    dailyPlanService: require('../services/DailyPlanService'),
    vehicleDetailService: require('../services/VehicleDetailService'),

    // === v0.8.0 Task 13：评估算法注入（场景A 计划评估 + 场景B 滚动优化）===
    productionPlanEvaluator: require('../services/evaluators/ProductionPlanEvaluator'),
    remainingSupplyOptimizer: require('../services/evaluators/RemainingSupplyOptimizer'),

    // === Task 4：vision 能力注入 ===
    // systemService / visionService 用单例（与 Orchestrator.systemService 共享 SystemService），
    // VisionService 配置是动态的（每次 execute 从 systemService.getVisionConfig 读取），构造时用空 cfg
    systemService: SystemService,
    visionService: new (require('../services/VisionService'))({}),

    // === v1.5.3 Task 4.2：workspace 能力注入（从 global 拿，main.js 已注入）===
    wiki: global.wikiEngine || null,
    workspace: global.workspaceManager || null,
    chatHistory: global.chatHistorySync || null  // v1.5.3 关键：是 Sync 不是 Exporter
  }

  const contextProvider = new DynamicContextProvider(allServices)
  contextProvider.setRegistry(skillRegistry)
  console.log('[AgentHandler] 使用 DynamicContextProvider（含 wiki/workspace/chatHistory）')

  skillExecutor = new SkillExecutor({ skillRegistry, contextProvider })

  // 设置 DeepSeekService 的 SkillExecutor
  DeepSeekService.setSkillExecutor(skillExecutor)

  // 初始化 LearningService（自动学习用户偏好）
  const learningService = require('../services/LearningService')
  learningService.init()

  // 初始化 SkillDebugger（MD技能调试工具）
  skillDebugger = new SkillDebugger({
    skillRegistry,
    skillExecutor,
    deepseekService: null // 延迟初始化
  })

  console.log(`[AgentHandler] Skill 系统初始化完成, 已加载 ${skillRegistry.size} 个 skills`)
  return skillRegistry
}

const getActiveLlmConfig = async () => {
  try {
    const config = await SystemService.getActiveLlmConfig()
    return config
  } catch (_) {
    return null
  }
}

async function getOrchestrator() {
  const activeConfig = await getActiveLlmConfig()
  if (!activeConfig || !activeConfig.apiKey) return null

  if (!orchestrator || cachedActiveConfigId !== activeConfig.id) {
    const ds = new DeepSeekService(activeConfig, SystemService)

    global.deepseekService = ds
    if (global.kgExtractor) {
      global.kgExtractor.llmClient = ds
    }
    if (global.wikiEngine) {
      global.wikiEngine.deepseekService = ds
    }
    if (global.summaryExtractor) {
      global.summaryExtractor.deepseekService = ds
    }
    if (global.kgExtractor) {
      global.kgExtractor.llmClient = ds
    }
    console.log('[agentHandler] deepseekService 已同步到 KGExtractor / SummaryExtractor / WikiEngine')

    await initSkillSystem()

    orchestrator = Orchestrator.create('unified', {
      deepseekService: ds,
      skillRegistry,
      skillExecutor,
      agentMemoryService,
      systemService: SystemService
    })
    // M0-2：全局 orchestrator 更新时同步 executor 的全局 fallback（confirm/abort 无 sessionId 路径）
    executor.setGlobalFallback(orchestrator)

    const { registerSlashCommandHandler } = require('./slashCommandHandler')
    registerSlashCommandHandler({
      deepseekService: ds,
      skillRegistry,
      skillExecutor
    })

    cachedActiveConfigId = activeConfig.id
  }

  return orchestrator
}

/**
 * 为指定 sessionId 获取/创建独立的 Orchestrator 实例
 * 每会话独立锁，多会话并行不冲突
 */
async function getOrchestratorForSession(sessionId) {
  const activeConfig = await getActiveLlmConfig()
  if (!activeConfig || !activeConfig.apiKey) return null

  if (!orchestrator || cachedActiveConfigId !== activeConfig.id) {
    await getOrchestrator()
  }
  if (!orchestrator) return null

  const ds = global.deepseekService

  // M0-2：只读复用当前运行中的会话 Orchestrator（不写 Map；写入只发生在 runAgentSession，与原行为一致）
  const existing = executor.getSessionOrchestrator(sessionId)
  if (existing && cachedActiveConfigId === activeConfig.id) {
    return existing
  }

  const ag = Orchestrator.create('unified', {
    deepseekService: ds,
    skillRegistry,
    skillExecutor,
    agentMemoryService,
    systemService: SystemService
  })

  return ag
}

// 注册 IPC 处理器（按域委托给拆分模块，channel 名与行为不变）
function registerAgentHandlers() {
  // 启动时初始化 Skill 系统
  initSkillSystem().catch(err => {
    console.error('[AgentHandler] Skill 系统初始化失败:', err)
  })

  // 拆分后各域注册模块：闭包所需可变状态统一以 getter 函数传入（执行时取最新值）
  registerAgentRunIpc(ipcMain, {
    executor,
    agentMemoryService,
    skillExecutor: () => skillExecutor,
    log: _log,
    logLogger: _logLogger,
    getDefaultSink: () => executorDefaultSink
  })

  registerSessionIpc(ipcMain, {
    executor,
    agentMemoryService,
    log: _log,
    getActiveLlmConfig
  })

  registerSkillIpc(ipcMain, {
    getSkillRegistry: () => skillRegistry,
    getSkillExecutor: () => skillExecutor,
    getSkillDebugger: () => skillDebugger,
    initSkillSystem,
    registerWorkspacePseudoSkills
  })

  registerPreferenceIpc(ipcMain, {
    getAgentMdService,
    AgentMdParser: require('../agent/agentMd/AgentMdParser').AgentMdParser,
    v2ToV1Proxy
  })
}

module.exports = {
  registerAgentHandlers,
  getSkillRegistry: () => skillRegistry,
  getSkillExecutor: () => skillExecutor,
  registerWorkspacePseudoSkills,
  // M0-2：暴露共享执行模块单例（R11 需把 executor 传给桌面 FanoutSink）与 setFanout（P1-2/R11 接线，M0 阶段仅定义不调用）
  getExecutor: () => executor,
  setFanout
}