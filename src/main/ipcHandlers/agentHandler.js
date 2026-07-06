const { ipcMain, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { rotateIfNeeded } = require('../utils/logRotator')
const _logFile = path.join(os.homedir(), '.concrete-mixdesign', 'agent-debug.log')
function _log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    // 写入前先按 5MB 阈值轮转，保留 5 个旧文件
    rotateIfNeeded(_logFile, { maxSize: 5 * 1024 * 1024, maxFiles: 5 })
    fs.appendFileSync(_logFile, line)
  } catch (_) {}
  console.log(msg)
}
const DeepSeekService = require('../services/DeepSeekService')
const Orchestrator = require('../agent/Orchestrator')
const SkillRegistry = require('../agent/SkillRegistry')
const SkillExecutor = require('../agent/SkillExecutor')
const DynamicContextProvider = require('../agent/DynamicContextProvider')
const SkillDebugger = require('../agent/SkillDebugger')
const { buildWorkspaceSkills } = require('../agent/workspaceTools')
const agentMemoryService = require('../services/AgentMemoryService')
const SystemService = require('../services/SystemService')
const { classifyError } = require('../agent/errorClassifier')
// v9.0.0 补充21：会话业务封装（ensureSession / discardSessionIfEmpty / listRecentSessionsWithMeta）
const SessionService = require('../db/services/SessionService')

// 缓存实例（Skill 系统全局共享，无状态安全）
let skillRegistry = null
let skillExecutor = null
let skillDebugger = null
let cachedActiveConfigId = null

// 每会话独立的 Orchestrator 实例（多会话并行）
// key: sessionId, value: { orchestrator, running: bool, startedAt: number, requestId: string }
const sessionAgents = new Map()
const AGENT_LOCK_TIMEOUT = 120000 // 2 分钟超时自动释放（spec 8.2）

// 兼容旧代码引用的全局 orchestrator（取最近一次创建的实例，仅供 getOrchestrator 内部使用）
let orchestrator = null

const { getInstance: getAgentMdService, agentMdPath } = require('../agent/agentMd')
const { AgentMdParser } = require('../agent/agentMd/AgentMdParser')
const { getSuggestionStore } = require('../agent/preferences')

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
    basicMixDesignService: require('../services/BasicMixDesignService'),
    mixDesignOptimizer: require('../services/MixDesignOptimizer'),
    salesQuoteCalculation: require('../services/SalesQuoteCalculationService'),
    salesQuoteHistory: require('../services/SalesQuoteHistoryService'),
    xgboostPrediction: require('../services/XGBoostPredictionService'),
    mixDesignToQuote: require('../services/MixDesignToQuoteService'),
    auditLogService: require('../services/AuditLogService'),

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

  const existing = sessionAgents.get(sessionId)
  if (existing && existing.orchestrator && cachedActiveConfigId === activeConfig.id) {
    return existing.orchestrator
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

// 注册 IPC 处理器
function registerAgentHandlers() {
  // 启动时初始化 Skill 系统
  initSkillSystem().catch(err => {
    console.error('[AgentHandler] Skill 系统初始化失败:', err)
  })

  ipcMain.handle('agent:run', async (event, { requestId, sessionId, message, mode, attachments }) => {
    // 生成 requestId（如渲染端未传）
    const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    // [DEBUG] 记录请求到达和锁状态（每会话独立锁）
    const lockState = sessionAgents.get(sessionId)
    _log(`[AgentHandler] 🔵 agent:run 收到请求 sessionId=${sessionId} requestId=${reqId} 该会话锁=${lockState?.running ? Math.round((Date.now() - lockState.startedAt) / 1000) + 's' : '无'} 图片数=${Array.isArray(attachments) ? attachments.length : 0}`)

    if (lockState && lockState.running) {
      if (Date.now() - lockState.startedAt > AGENT_LOCK_TIMEOUT) {
        _log(`[AgentHandler] ⚠️ agent:run 锁超时自动释放 sessionId=${sessionId} requestId=${reqId} (held ${Math.round((Date.now() - lockState.startedAt) / 1000)}s)`)
        lockState.running = false
      } else {
        _log(`[AgentHandler] 🚫 agent:run 被锁拒绝（同一会话已有任务在跑）sessionId=${sessionId} requestId=${reqId}`)
        return { success: false, error: '该会话已有任务在执行，请稍等' }
      }
    }

    try {
      const ag = await getOrchestratorForSession(sessionId)
      if (!ag) {
        _log(`[AgentHandler] ❌ agent:run Orchestrator 未初始化 requestId=${reqId}`)
        return { success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' }
      }

      // 注册会话锁
      sessionAgents.set(sessionId, { orchestrator: ag, running: true, startedAt: Date.now(), requestId: reqId })
      _log(`[AgentHandler] 🔒 agent:run 获取锁 sessionId=${sessionId} requestId=${reqId}`)

      // v9.1.0 修复：透传 attachments（图片附件）到 Orchestrator
      // - 渲染端 sendMessage 时把 chatState.attachments 通过 IPC 传进来
      // - 旧实现解构时丢掉了 attachments 字段，Agent 永远看不到图片
      // - 现在 attachments 进入 UnifiedStrategy.execute，由 strategy 决定如何用（调 analyze_concrete_image 技能）
      _log(`[AgentHandler] 🚀 agent:run 开始执行 requestId=${reqId} message="${message.slice(0, 50)}" mode=${mode} attachments=${attachments?.length || 0}`)
      const result = await ag.run({ sessionId, message, mode: mode || 'auto', webContents: event.sender, attachments: Array.isArray(attachments) ? attachments : [] })
      _log(`[AgentHandler] ✅ agent:run 执行完成 requestId=${reqId}: ${JSON.stringify({ success: result?.success, hasContent: !!result?.content, contentLen: result?.content?.length || 0, error: result?.error })}`)

      // UnifiedStrategy 已通过流式事件发送 type: 'done' / type: 'error'，这里不再重复发送

      return { success: true, result }
    } catch (error) {
      _log(`[AgentHandler] 💥 agent:run 异常 requestId=${reqId}: ${error.message}`)
      // 异常情况（Orchestrator 层面崩溃）：分类错误并发送标准化错误事件
      const classified = classifyError(error, {
        callSite: 'agentHandler.agent:run',
        sessionId,
        requestId: reqId,
      })
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:progress', {
            type: 'error',
            error: classified,
            sessionId,
            requestId: reqId,
          })
        }
      } catch (_) {}

      return { success: false, error: classified }
    } finally {
      // 释放该会话锁 + 释放 Orchestrator 实例（避免内存累积，下次重新创建）
      const s = sessionAgents.get(sessionId)
      if (s) {
        s.orchestrator = null
        s.running = false
        s.startedAt = 0
      }
      // v9.1.0 todo_manage：清理该会话的内存清单，防内存泄漏
      try {
        const todoManage = require('../skills/todo-manage')
        if (todoManage._cleanupSession) todoManage._cleanupSession(sessionId)
      } catch (e) {
        _log(`[AgentHandler] 清理 todo_manage 失败: ${e.message}`)
      }
      _log(`[AgentHandler] 🔓 agent:run 释放锁 sessionId=${sessionId} requestId=${reqId}`)
    }
  })

  ipcMain.handle('agent:pause', async (_event, { requestId, sessionId }) => {
    const s = sessionId ? sessionAgents.get(sessionId) : null
    if (s?.orchestrator) s.orchestrator.pause()
    return { success: true }
  })

  ipcMain.handle('agent:resume', async (_event, { requestId, sessionId }) => {
    const s = sessionId ? sessionAgents.get(sessionId) : null
    if (s?.orchestrator) s.orchestrator.resume()
    return { success: true }
  })

  ipcMain.handle('agent:abort', async (_event, { requestId, sessionId }) => {
    // 优先按 sessionId 定位（新协议）；fallback 到旧的单例 orchestrator
    if (sessionId) {
      const s = sessionAgents.get(sessionId)
      if (s?.orchestrator) s.orchestrator.abort()
    } else if (orchestrator) {
      orchestrator.abort()
    }
    return { success: true }
  })

  ipcMain.handle('agent:saveMessage', async (_event, { sessionId, role, content, metadata, stopReason }) => {
    if (!sessionId) {
      return { success: false, error: 'sessionId is required' }
    }
    if (role && !['user', 'assistant', 'system', 'tool'].includes(role)) {
      return { success: false, error: `invalid role: ${role}` }
    }
    try {
      await agentMemoryService.saveMessage({ sessionId, role, content, metadata, stopReason })

      // v9.0.0 补充21：首条消息触达时通过 SessionService.ensureSession 创建 ChatSession 记录
      // 之前的 createSession IPC 已在渲染端移除（未发送消息的会话不再写库）
      if (role === 'user' && content && sessionId) {
        // 异步 IIFE：fire-and-forget，saveMessage 立即返回
        ;(async () => {
          try {
            const currentWorkspacePath = global.workspaceManager ? global.workspaceManager.current()?.path : null
            const { created, session } = await SessionService.ensureSession({
              sessionId,
              sessionName: null,
              workspacePath: currentWorkspacePath
            })

            // 检查 sessionName 是否是默认名（兼容历史遗留：空 / 新会话- / 新对话 / 对话 YYYY-MM-DD HH:mm）
            const currentName = session?.sessionName || ''
            const isDefaultName = (name) =>
              !name ||
              name.startsWith('新会话-') ||
              name.startsWith('新对话 ') ||
              /^对话 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(name) ||
              /^对话 \d{2}-\d{2} \d{2}:\d{2}$/.test(name)
            const isFirstMessage = created || isDefaultName(currentName)

            let sessionName
            if (isFirstMessage) {
              // 尝试使用 AI 生成摘要
              try {
                const ag = await getOrchestrator()
                if (ag && ag.deepseekService) {
                  const prompt = `请从以下用户消息中提取关键信息，生成一个简短的会话标题（不超过20个字符）。
要求：
1. 保留核心意图
2. 去除语气词和无关信息
3. 如果包含具体参数（如强度等级、材料名称），优先保留
4. 只返回标题文本，不要添加引号或其他格式

用户消息：${content.trim()}`
                  sessionName = await ag.deepseekService.invoke(prompt)
                  sessionName = sessionName.trim().substring(0, 20)
                  _log(`[AgentHandler] AI摘要生成成功: "${sessionName}"`)
                }
              } catch (err) {
                _log(`[AgentHandler] AI摘要生成失败，使用截取方式: ${err.message}`)
              }
            }

            // 后续消息（已有非默认标题）：只更新 lastActivity，不动 sessionName
            // 这样历史会话的标题保持为用户第一条消息生成的摘要，不会被最近消息覆盖
            if (!isFirstMessage) {
              _log(`[AgentHandler] 后续消息，仅更新 lastActivity（标题保持不变）`)
              return
            }

            // 第一条消息：AI 摘要失败时使用消息内容前 15 字（grapheme-safe），不再 fallback 到时间格式
            if (!sessionName) {
              const trimmed = content.trim()
              sessionName = trimmed ? [...trimmed].slice(0, 15).join('') : '新会话'
            }

            await SessionService.ensureSession({
              sessionId,
              sessionName,
              workspacePath: currentWorkspacePath
            })
            _log(`[AgentHandler] 会话标题已更新: "${sessionName}"`)

            // 标题变更后立即失效 listSessionsGrouped 缓存，确保前端刷新拿到最新标题
            if (global.chatHistorySync?.invalidateGroupedCache) {
              global.chatHistorySync.invalidateGroupedCache()
            }

            // 通知前端刷新会话列表（解决异步 AI 摘要晚于 loadSessionList 完成的时序问题）
            try {
              if (_event && _event.sender && !_event.sender.isDestroyed()) {
                _event.sender.send('agent:sessionUpdated', { sessionId, sessionName })
              }
            } catch (_) {}
          } catch (err) {
            _log(`[AgentHandler] 异步更新会话标题失败: ${err.message}`)
          }
        })()
      }

      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // v9.1.0 ask_user：按 sessionId 路由到对应会话的 Orchestrator.resolveConfirmation
  // 旧实现用全局 orchestrator，多会话并行时会路由错误（A 会话的问题被 B 会话回答）
  ipcMain.handle('agent:confirm', async (_event, { sessionId, confirmed, args }) => {
    // 优先按 sessionId 路由（每会话独立 Orchestrator）
    if (sessionId) {
      const s = sessionAgents.get(sessionId)
      if (s?.orchestrator && typeof s.orchestrator.resolveConfirmation === 'function') {
        s.orchestrator.resolveConfirmation(confirmed, args)
        return { success: true }
      }
    }
    // 兼容旧路径：无 sessionId 时退回全局 orchestrator
    if (orchestrator && typeof orchestrator.resolveConfirmation === 'function') {
      orchestrator.resolveConfirmation(confirmed, args)
    }
    return { success: true }
  })

  ipcMain.handle('agent:listSessions', async () => {
    const { ChatHistory, ChatSession } = require('../db/database')
    const { fn, col, literal } = require('sequelize')
    // 取最近 50 个 sessionId
    const rows = await ChatHistory.findAll({
      attributes: [
        'sessionId',
        [fn('MAX', col('createdAt')), 'lastActivity']
      ],
      group: ['sessionId'],
      order: [[literal('lastActivity'), 'DESC']],
      limit: 50,
      raw: true
    })

    // 批量查 sessionName
    const sessionIds = rows.map(r => r.sessionId)
    const sessions = await ChatSession.findAll({
      where: { sessionId: sessionIds },
      raw: true
    })
    const nameMap = Object.fromEntries(sessions.map(s => [s.sessionId, s.sessionName]))

    return {
      success: true,
      sessions: rows.map(r => ({
        sessionId: r.sessionId,
        lastActivity: r.lastActivity,
        sessionName: nameMap[r.sessionId] || null
      }))
    }
  })

  // Task 2.15b: 按工作区分组列出所有会话
  ipcMain.handle('agent:listSessionsGrouped', async () => {
    if (!global.chatHistorySync) {
      return { workspaces: [], unclassified: [] }
    }
    return await global.chatHistorySync.listSessionsGrouped()
  })

  ipcMain.handle('agent:getSessionMessages', async (_event, { sessionId, before }) => {
    const messages = await agentMemoryService.getHistory(sessionId, { limit: 20, before })
    // 剥离 metadata.timeline（大对象，含 reasoning + tool 结果）
    // 历史消息切回时不回放思考过程，只显示纯文本（DB 仍保留 timeline，需要时可单独查询）
    // 流式过程中的 timeline 来自 state.agent.timeline，不受影响
    const slimMessages = messages.map(m => {
      if (!m.metadata) return m
      const { timeline, ...restMetadata } = m.metadata
      return { ...m, metadata: restMetadata }
    })
    return { success: true, messages: slimMessages }
  })

  ipcMain.handle('agent:deleteSession', async (_event, { sessionId }) => {
    await agentMemoryService.deleteSession(sessionId)
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true }
  })

  ipcMain.handle('agent:duplicateSession', async (_event, { sessionId }) => {
    const result = await agentMemoryService.duplicateSession(sessionId)
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true, sessionId: result.sessionId, sessionName: result.sessionName }
  })

  ipcMain.handle('agent:createSession', async (_event, { sessionId, sessionName }) => {
    // v9.0.0 补充21：改为调用 SessionService.ensureSession
    // 旧行为：立即写入默认时间戳标题。新行为：仅当调用方显式传 sessionName（非 null/undefined）时创建，否则保留空标题等首条消息摘要。
    // 旧渲染端 createSession 已不再调用本 IPC（首条消息才落库），保留 handler 仅作向后兼容。
    const currentWorkspacePath = global.workspaceManager ? global.workspaceManager.current()?.path : null
    let finalName = sessionName
    if (finalName === undefined) {
      // 显式未指定 → 用历史兜底（兼容旧调用方）
      finalName = `新对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
    }
    // null 透传：保留空标题，由首条消息触发 AI 摘要生成
    await SessionService.ensureSession({
      sessionId,
      sessionName: finalName,
      workspacePath: currentWorkspacePath
    })
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true }
  })

  // v9.0.0 补充21：渲染端主动丢弃空会话（用户切换/关闭时清理）
  ipcMain.handle('agent:discardSession', async (_event, { sessionId }) => {
    try {
      const result = await SessionService.discardSessionIfEmpty(sessionId)
      if (result.discarded && global.chatHistorySync?.invalidateGroupedCache) {
        global.chatHistorySync.invalidateGroupedCache()
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // v9.0.0 补充21：欢迎页获取最近会话列表（含消息数 + 工作区路径）
  ipcMain.handle('agent:listRecentSessions', async (_event, { limit = 10 } = {}) => {
    try {
      const sessions = await SessionService.listRecentSessionsWithMeta(limit)
      return { success: true, sessions }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agent:getSessionInfo', async (_event, { sessionId }) => {
    const { ChatSession } = require('../db/database')
    const session = await ChatSession.findOne({ where: { sessionId } })
    return session ? {
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      workspacePath: session.workspacePath,
      lastActivity: session.lastActivity
    } : null
  })

  ipcMain.handle('agent:renameSession', async (_event, { sessionId, sessionName }) => {
    const { ChatSession } = require('../db/database')
    await ChatSession.update(
      { sessionName },
      { where: { sessionId } }
    )
    if (global.chatHistorySync?.invalidateGroupedCache) global.chatHistorySync.invalidateGroupedCache()
    return { success: true }
  })

  ipcMain.handle('agent:clearAllMemory', async () => {
    const { ChatHistory, ChatSession, CorrectionRule } = require('../db/database')
    // 注意：user_preferences 表已在阶段 B 迁移中删除，不在此处引用
    await ChatHistory.destroy({ where: {}, truncate: true })
    await ChatSession.destroy({ where: {}, truncate: true })  // 清空会话表
    await CorrectionRule.destroy({ where: {}, truncate: true })
    return { success: true }
  })

  ipcMain.handle('agent:saveCorrection', async (_event, correction) => {
    try {
      const LearningService = require('../services/LearningService')
      await LearningService.saveCorrection(correction)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ===== Skill 管理 =====

  ipcMain.handle('skill:listAll', async () => {
    // 如果未初始化，尝试初始化
    if (!skillRegistry) {
      try {
        await initSkillSystem()
      } catch (err) {
        return { success: false, error: 'Skill 系统初始化失败: ' + err.message }
      }
    }
    const skills = skillExecutor ? skillExecutor.listSkills() : []
    return { success: true, skills }
  })

  ipcMain.handle('skill:getUserDir', async () => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    return { success: true, dir: skillRegistry.getUserDir() }
  })

  ipcMain.handle('skill:getUserSkills', async () => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const skills = skillRegistry.getUserSkills()
    return { success: true, skills }
  })

  ipcMain.handle('skill:openUserDir', async () => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const { shell } = require('electron')
    const dir = skillRegistry.getUserDir()
    shell.openPath(dir)
    return { success: true }
  })

  ipcMain.handle('skill:reload', async () => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      // 重新发现 skills
      skillRegistry._skills.clear()
      await skillRegistry.discover()
      // 重新注册工作区伪技能（避免丢失 workspace_readPage 等）
      registerWorkspacePseudoSkills()
      return { success: true, count: skillRegistry.size, names: skillRegistry.skillNames }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:getInfo', async (_event, { skillName }) => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const fs = require('fs')
    const path = require('path')
    const userDir = skillRegistry.getUserDir()

    // 检查.js文件
    let filePath = path.join(userDir, `${skillName}.js`)
    let isMD = false

    if (!fs.existsSync(filePath)) {
      // 检查.md文件
      filePath = path.join(userDir, `${skillName}.md`)
      isMD = true
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: '技能文件不存在' }
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return { success: true, data: { skillName, filePath, content, isMD } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:delete', async (_event, { skillName }) => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const fs = require('fs')
    const path = require('path')
    const userDir = skillRegistry.getUserDir()

    // 检查.js文件
    let filePath = path.join(userDir, `${skillName}.js`)
    if (!fs.existsSync(filePath)) {
      // 检查.md文件
      filePath = path.join(userDir, `${skillName}.md`)
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: '技能文件不存在' }
    }

    try {
      fs.unlinkSync(filePath)
      // 重新加载
      skillRegistry._skills.delete(skillName)
      await skillRegistry.discover()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ===== Skill 调试 =====

  ipcMain.handle('skill:debug:preview', async (_event, { skillName, args }) => {
    if (!skillDebugger) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      return skillDebugger.previewInstruction(skillName, args || {})
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:debug:validate', async (_event, { skillName }) => {
    if (!skillDebugger) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      return skillDebugger.validateSkill(skillName)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:debug:listMD', async () => {
    if (!skillDebugger) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      return skillDebugger.listMDSkills()
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:create', async (_event, { skillName, description, functionality, template }) => {
    if (!skillRegistry) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const fs = require('fs')
    const path = require('path')
    const userDir = skillRegistry.getUserDir()
    const filePath = path.join(userDir, `${skillName}.js`)

    if (fs.existsSync(filePath)) {
      return { success: false, error: { code: 'NAME_EXISTS', message: '技能名称已存在' } }
    }

    // 模板系统：根据 template 类型生成不同骨架
    const templates = {
      query: `/**
 * ${description || '查询类技能'}
 *
 * 功能：从数据库或外部源查询数据，返回结构化结果
 * 示例：查询材料列表、查询历史记录、查询规范条款
 */

module.exports = {
  name: '${skillName}',
  description: '${description || '查询类技能'}',
  version: '1.0.0',
  category: 'query',

  parameters: {
    keyword: {
      type: 'string',
      description: '搜索关键词',
      required: false
    },
    limit: {
      type: 'integer',
      description: '返回条数，默认 10',
      required: false,
      min: 1,
      max: 100
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { keyword, limit = 10 } = args

    logger.info('执行查询: keyword=' + keyword + ', limit=' + limit)

    try {
      // TODO: 在这里实现你的查询逻辑
      // 可以使用 context 中的服务：
      //   context.materialService  - 材料库
      //   context.mixDesignService - 配合比服务

      const results = []

      return {
        success: true,
        data: { results, total: results.length }
      }
    } catch (error) {
      logger.error('查询失败:', error)
      return {
        success: false,
        error: { code: 'QUERY_FAILED', message: '查询失败: ' + error.message }
      }
    }
  }
}
`,

      calculate: `/**
 * ${description || '计算类技能'}
 *
 * 功能：根据输入参数执行数学计算或工程计算
 * 示例：配合比计算、强度预测、成本估算
 */

module.exports = {
  name: '${skillName}',
  description: '${description || '计算类技能'}',
  version: '1.0.0',
  category: 'core',

  parameters: {
    input: {
      type: 'number',
      description: '输入数值',
      required: true,
      min: 0
    },
    unit: {
      type: 'string',
      description: '单位（可选）',
      required: false,
      enum: ['MPa', 'kg/m3', 'mm', '%']
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { input, unit } = args

    logger.info('开始计算: input=' + input + (unit ? ' ' + unit : ''))

    try {
      // TODO: 在这里实现你的计算逻辑
      // 可以使用 context 中的服务：
      //   context.mixDesignService     - 配合比计算
      //   context.mixDesignOptimizer   - 成本优化
      //   context.xgboostPrediction    - 强度预测

      const result = {
        input,
        output: input, // 替换为实际计算结果
        unit: unit || '',
        formula: '待实现'
      }

      return {
        success: true,
        data: result
      }
    } catch (error) {
      logger.error('计算失败:', error)
      return {
        success: false,
        error: { code: 'CALCULATION_FAILED', message: '计算失败: ' + error.message }
      }
    }
  }
}
`,

      check: `/**
 * ${description || '检查类技能'}
 *
 * 功能：校验数据是否符合规范、标准或业务规则
 * 示例：规范合规检查、参数范围校验、数据完整性检查
 */

module.exports = {
  name: '${skillName}',
  description: '${description || '检查类技能'}',
  version: '1.0.0',
  category: 'analysis',

  parameters: {
    data: {
      type: 'object',
      description: '待检查的数据对象',
      required: true
    },
    strict: {
      type: 'boolean',
      description: '是否严格模式（默认 false）',
      required: false
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { data, strict = false } = args

    logger.info('开始检查: strict=' + strict)

    try {
      // TODO: 在这里实现你的检查逻辑
      // 可以使用 context 中的服务：
      //   context.materialService  - 材料库

      const issues = []     // 发现的问题
      const warnings = []   // 警告信息

      // 示例检查逻辑：
      // if (!data.strength) {
      //   issues.push({ field: 'strength', message: '缺少强度等级' })
      // }

      const passed = issues.length === 0

      return {
        success: true,
        data: {
          passed,
          issues,
          warnings,
          summary: passed ? '检查通过' : '发现 ' + issues.length + ' 个问题'
        }
      }
    } catch (error) {
      logger.error('检查失败:', error)
      return {
        success: false,
        error: { code: 'CHECK_FAILED', message: '检查失败: ' + error.message }
      }
    }
  }
}
`
    }

    // 选择模板，默认用 query
    const selectedTemplate = templates[template] || templates.query
    const skillCode = selectedTemplate

    try {
      // 确保目录存在
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true })
      }
      fs.writeFileSync(filePath, skillCode, 'utf8')
      // 重新加载
      await skillRegistry.discover()
      return { success: true, data: { skillName, filePath } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ===== AgentMd (用户自定义规则) =====

  ipcMain.handle('agentMd:load', async () => {
    try {
      const svc = getAgentMdService()
      return { success: true, data: svc.getCached() }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agentMd:save', async (_event, { content }) => {
    try {
      const svc = getAgentMdService()
      // 4KB 警告
      if (content && content.length > 4 * 1024) {
        console.warn(`[AgentMd] 保存内容 ${content.length} 字节，超过 4KB 阈值`)
      }
      await svc.saveToFile(content || '')
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  /**
   * 整体保存"我的规则" tab 的结构化对象（v4.6.x 修复方案 A）
   *
   * 老方案缺陷：渲染进程手工拼 YAML 字符串再走 agentMd:save，
   *   - 双轨序列化（前端拼字符串 vs 主进程 yaml.dump）容易写不一致
   *   - 一处 bug 触发 YAML 解析失败，watcher 二次抛错会让主进程崩溃
   * 新方案：渲染进程只传结构化 rules 对象，序列化统一由主进程 AgentMdParser.formatToMarkdown 完成。
   * 这与设计文档 docs/superpowers/specs/2026-06-15-user-preference-redesign-design.md §5.2 进程归属约定一致。
   */
  ipcMain.handle('agent:rules:upsert', async (_event, { rules }) => {
    try {
      if (!rules || typeof rules !== 'object') {
        return { success: false, error: '参数 rules 必须是对象' }
      }
      const svc = getAgentMdService()
      const content = AgentMdParser.formatToMarkdown(rules)
      // 4KB 警告
      if (content && content.length > 4 * 1024) {
        console.warn(`[AgentMd] 保存内容 ${content.length} 字节，超过 4KB 阈值`)
      }
      await svc.saveToFile(content)
      return { success: true, data: svc.getCached() }
    } catch (err) {
      console.error('[AgentHandler] agent:rules:upsert 失败:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agentMd:reload', async () => {
    try {
      const svc = getAgentMdService()
      svc.loadFromFile()
      return { success: true, data: svc.getCached() }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('shell:openAgentMd', async () => {
    try {
      await shell.openPath(agentMdPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ===== 偏好建议 IPC（spec §5.2）=====

  function _wrap(fn) {
    return async (event, payload) => {
      try {
        return await fn(event, payload)
      } catch (err) {
        console.error('[AgentHandler] preference IPC error:', err.message)
        return { success: false, error: err.message }
      }
    }
  }

  ipcMain.handle('agent:suggestions:list', _wrap(async () => {
    return { success: true, suggestions: getSuggestionStore().list() }
  }))

  ipcMain.handle('agent:suggestions:accept', _wrap(async (_event, { id }) => {
    const sugg = getSuggestionStore().acceptById(id)
    if (!sugg) {
      return { success: false, error: '建议不存在或已被处理' }
    }
    // 合并到 agent.md.materials
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const prefs = v2ToV1Proxy(cached.parsed).professionalPrefs
    const newItem = sugg.proposedYaml
    if (newItem.method) {
      prefs.method = newItem.method
    } else {
      // 避免重复（结构化比较）
      const exists = prefs.materials.some(m =>
        m.category === newItem.category &&
        m.dimension === newItem.dimension &&
        (m.metric || '') === (newItem.metric || '') &&
        (m.value || '') === (newItem.value || '')
      )
      if (!exists) prefs.materials.push(newItem)
    }
    v2ToV1Proxy(cached.parsed).professionalPrefs = prefs
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true, newMaterials: prefs.materials }
  }))

  ipcMain.handle('agent:suggestions:dismiss', _wrap(async (_event, { id }) => {
    const ok = getSuggestionStore().dismissById(id)
    if (!ok) {
      return { success: false, error: '建议不存在或已被处理' }
    }
    return { success: true }
  }))

  ipcMain.handle('agent:suggestions:blacklist', _wrap(async (_event, { id, type }) => {
    getSuggestionStore().dismissById(id)
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const list = v2ToV1Proxy(cached.parsed).ignoredSuggestionTypes
    if (!list.includes(type)) {
      list.push(type)
    }
    v2ToV1Proxy(cached.parsed).ignoredSuggestionTypes = list
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true }
  }))

  ipcMain.handle('agent:preferences:get', _wrap(async () => {
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const prefs = v2ToV1Proxy(cached.parsed).professionalPrefs
    return { materials: prefs.materials, method: prefs.method }
  }))

  ipcMain.handle('agent:preferences:upsert', _wrap(async (_event, { materials, method }) => {
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    v2ToV1Proxy(cached.parsed).professionalPrefs = { materials, method }
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true }
  }))

  ipcMain.handle('agent:preferences:delete', _wrap(async (_event, { index }) => {
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const mats = v2ToV1Proxy(cached.parsed).professionalPrefs.materials
    if (index < 0 || index >= mats.length) {
      return { success: false, error: `索引越界: ${index}` }
    }
    mats.splice(index, 1)
    v2ToV1Proxy(cached.parsed).professionalPrefs.materials = mats
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true }
  }))

}

module.exports = {
  registerAgentHandlers,
  getSkillRegistry: () => skillRegistry,
  getSkillExecutor: () => skillExecutor,
  registerWorkspacePseudoSkills
}
