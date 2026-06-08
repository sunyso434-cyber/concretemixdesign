const { ipcMain } = require('electron')
const DeepSeekService = require('../services/DeepSeekService')
const Orchestrator = require('../agent/Orchestrator')
const SkillRegistry = require('../agent/SkillRegistry')
const SkillExecutor = require('../agent/SkillExecutor')
const DynamicContextProvider = require('../agent/DynamicContextProvider')
const SkillDebugger = require('../agent/SkillDebugger')
const agentMemoryService = require('../services/AgentMemoryService')
const SystemService = require('../services/SystemService')

// 缓存实例
let orchestrator = null
let skillRegistry = null
let skillExecutor = null
let skillDebugger = null
let cachedApiKey = null
let agentRunning = false
let agentRunningAt = 0
const AGENT_LOCK_TIMEOUT = 300000 // 5 分钟超时自动释放

// 初始化 Skill 系统（应用启动时调用）
async function initSkillSystem() {
  if (skillRegistry) return skillRegistry

  console.log('[AgentHandler] 初始化 Skill 系统...')
  skillRegistry = new SkillRegistry()
  await skillRegistry.discover()

  // 设置 DeepSeekService 的 SkillRegistry
  DeepSeekService.setSkillRegistry(skillRegistry)

  // 创建 DynamicContextProvider（按需注入服务，节省token）
  const allServices = {
    materialService: require('../services/MaterialService'),
    mixDesignService: require('../services/MixDesignService'),
    basicMixDesignService: require('../services/BasicMixDesignService'),
    mixDesignOptimizer: require('../services/MixDesignOptimizer'),
    complianceService: require('../services/StandardComplianceService'),
    knowledgeService: require('../services/StandardKnowledgeService'),
    salesQuoteCalculation: require('../services/SalesQuoteCalculationService'),
    salesQuoteHistory: require('../services/SalesQuoteHistoryService'),
    xgboostPrediction: require('../services/XGBoostPredictionService'),
    mixDesignToQuote: require('../services/MixDesignToQuoteService')
  }

  const contextProvider = new DynamicContextProvider(allServices)
  contextProvider.setRegistry(skillRegistry)
  console.log('[AgentHandler] 使用 DynamicContextProvider（按需注入服务）')

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

  if (!orchestrator || cachedApiKey !== apiKey) {
    const ds = new DeepSeekService(apiKey, SystemService)

    // 确保 Skill 系统已初始化
    await initSkillSystem()

    // 使用 Orchestrator.create 工厂方法（v4.4.0 B2.3）
    orchestrator = Orchestrator.create('unified', {
      deepseekService: ds,
      skillRegistry,
      skillExecutor,
      agentMemoryService,
      systemService: SystemService
    })
    cachedApiKey = apiKey
  }

  return orchestrator
}

// 注册 IPC 处理器
function registerAgentHandlers() {
  // 启动时初始化 Skill 系统
  initSkillSystem().catch(err => {
    console.error('[AgentHandler] Skill 系统初始化失败:', err)
  })

  ipcMain.handle('agent:run', async (event, { requestId, sessionId, message, mode }) => {
    if (agentRunning) {
      if (Date.now() - agentRunningAt > AGENT_LOCK_TIMEOUT) {
        agentRunning = false
      } else {
        return { success: false, error: '上一个任务还在执行中，请稍等' }
      }
    }
    agentRunning = true
    agentRunningAt = Date.now()
    try {
      const ag = await getOrchestrator()
      if (!ag) {
        return { success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' }
      }
      const result = await ag.run({ sessionId, message, mode: mode || 'auto', webContents: event.sender })

      // 通知前端 Agent 执行完成（UnifiedStrategy 不会自己发 progress 事件）
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:progress', {
            status: 'done',
            steps: [],
            result: { reply: result?.content || '' }
          })
        }
      } catch (_) {}

      return { success: true, result }
    } catch (error) {
      // 通知前端 Agent 执行出错
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:progress', {
            status: 'error',
            steps: [],
            error: error.message
          })
        }
      } catch (_) {}

      return { success: false, error: error.message }
    } finally {
      agentRunning = false
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
      //   context.knowledgeService - 规范知识库
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
      //   context.complianceService - 规范合规检查
      //   context.knowledgeService  - 规范知识库查询

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
}

module.exports = {
  registerAgentHandlers,
  getSkillRegistry: () => skillRegistry,
  getSkillExecutor: () => skillExecutor
}
