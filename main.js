const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const { cleanupOldSessions } = require('./src/main/db/services/SessionCleanupService')

// 设置日志文件路径（在 app ready 后获取）
let logFilePath = null
function initLogPath() {
  try {
    logFilePath = path.join(app.getPath('userData'), 'app.log')
  } catch (e) {
    logFilePath = path.join(__dirname, 'app.log')
  }
}

// 日志写入改为异步 buffer 模式（避免同步 IO 阻塞主进程事件循环）
let _logBuffer = []
let _logFlushTimer = null
function logToFile(message) {
  if (!logFilePath) initLogPath()
  const timestamp = new Date().toISOString()
  _logBuffer.push(`[${timestamp}] ${message}\n`)
  // 500ms 批量写入
  if (!_logFlushTimer) {
    _logFlushTimer = setTimeout(() => {
      const data = _logBuffer.join('')
      _logBuffer = []
      _logFlushTimer = null
      try {
        fs.appendFile(logFilePath, data, 'utf8', () => {})
      } catch (e) {}
    }, 500)
  }
}

// 覆盖 console.log 以便所有日志都输出到文件
const originalLog = console.log
const originalError = console.error
const originalWarn = console.warn
console.log = function(...args) {
  const message = args.join(' ')
  originalLog.apply(console, args)
  logToFile('[LOG] ' + message)
}
console.error = function(...args) {
  const message = args.join(' ')
  originalError.apply(console, args)
  logToFile('[ERROR] ' + message)
}
console.warn = function(...args) {
  const message = args.join(' ')
  originalWarn.apply(console, args)
  logToFile('[WARN] ' + message)
}

const { sequelize, syncModels } = require('./src/main/db/database')
// 导入IPC处理器
require('./src/main/ipcHandlers/materialHandler')
require('./src/main/ipcHandlers/mixDesignHandler')
require('./src/main/ipcHandlers/mixDesignOptimizerHandler') // 新增：优化器 IPC 处理器
require('./src/main/ipcHandlers/inverseCalculationHandler') // 原材料参数反算 IPC 处理器
const SystemHandler = require('./src/main/ipcHandlers/systemHandler')
require('./src/main/ipcHandlers/aiAnalysisHandler')
require('./src/main/ipcHandlers/salesQuoteHandler') // 销售报价 IPC 处理器
require('./src/main/ipcHandlers/mixDesignToQuoteHandler') // 配合比→报价数据流 IPC 处理器
require('./src/main/ipcHandlers/xgboostPredictionHandler') // XGBoost性能预测 IPC 处理器
require('./src/main/ipcHandlers/visionHandler') // Task 8：视觉图片上传/列出 IPC 处理器
require('./src/main/ipcHandlers/agentHandler').registerAgentHandlers() // AI Agent IPC 处理器
const { registerLlmHandlers } = require('./src/main/ipcHandlers/llmHandler')
registerLlmHandlers()

// agent.md 用户自定义规则服务（单例，启动时初始化）
// Task 6：setWorkspacePath 跟随 WorkspaceManager 切换工作区，触发老 v1 自动迁移
const { init: initAgentMd, setWorkspacePath: setAgentMdWorkspacePath } = require('./src/main/agent/agentMd')

// 数据库就绪状态
let isDatabaseReady = false
module.exports.getDatabaseReadyStatus = function() {
  return isDatabaseReady
}

// 初始化数据库（在后台执行，不阻塞UI）
async function initializeDatabase() {
  try {
    await sequelize.authenticate()
    console.log('数据库连接成功')
    // 同步所有模型
    await syncModels()
    console.log('数据库表同步完成')

    // 阶段 B 数据迁移（废弃 user_preferences + agent.md v1→v2）
    // 注意：必须在 initializeDatabase 函数体内、syncModels 之后，保证表已存在
    try {
      const { sequelize: db } = require('./src/main/db/database')
      const UserPreference = require('./src/main/db/models/UserPreference')
      const deprecateMigration = require('./migrations/2026-06-15-deprecate-user-preferences')
      const agentMdMigration = require('./migrations/2026-06-15-migrate-agent-md-v2')
      const { getInstance: getAgentMdSvc, agentMdPath: mdPath } = require('./src/main/agent/agentMd')

      // 检查 user_preferences 表是否还存在
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_preferences'",
        { type: db.QueryTypes.SELECT }
      )
      if (tables.length > 0) {
        console.log('[main] 检测到 user_preferences 表，开始执行废弃迁移...')
        // 用 raw SQL 建 migration_log 表（避免和 Sequelize 临时 define 混用）
        await db.query(`CREATE TABLE IF NOT EXISTS migration_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          appliedAt DATETIME NOT NULL,
          details TEXT
        )`)
        // 迁移脚本不依赖 MigrationLog 模型，logs 通过 raw SQL 写入（见 Task 10 实现）
        // 但 deprecateMigration.up 仍接受 MigrationLog 参数以便它写日志，所以用一个查询接口包装
        const logWriter = {
          async create({ name, appliedAt, details }) {
            await db.query(
              'INSERT INTO migration_log (name, appliedAt, details) VALUES (?, ?, ?)',
              { replacements: [name, appliedAt, JSON.stringify(details || {})], type: db.QueryTypes.INSERT }
            )
          }
        }
        await deprecateMigration.up({
          context: {
            sequelize: db,
            UserPreference, // 直接 import 已有模型（带 id/key/value/category 列定义）
            logWriter,
            dbPath: ''
          }
        })
        await agentMdMigration.up({ context: { agentMdPath: mdPath } })
        // 触发 agent.md 重新加载
        getAgentMdSvc().loadFromFile()
        console.log('[main] 数据迁移完成')
      }
    } catch (err) {
      console.error('[main] 数据迁移失败（应用继续启动）:', err.message)
    }

    // 初始化预设材料
    const MaterialService = require('./src/main/services/MaterialService')
    await MaterialService.initDefaultMaterials()
    // 初始化系统参数
    const SystemService = require('./src/main/services/SystemService')
    await SystemService.initDefaultParams()

    // 标记数据库就绪
    isDatabaseReady = true
    console.log('数据库初始化完成')

    // 初始化学习服务（在数据库就绪后）
    const LearningService = require('./src/main/services/LearningService')
    LearningService.init()
    console.log('学习服务初始化完成')

    // 通知渲染进程数据库已就绪
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      windows[0].webContents.send('database-ready')
    }
  } catch (err) {
    console.error('数据库初始化失败:', err)
  }
}

// 创建窗口
async function createWindow() {
  // 数据库已在 app.whenReady 中初始化，这里不需要再初始化
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'public/logo.png'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'src/main/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.setMenuBarVisibility(false)

  // 加载应用
  console.log('当前环境:', process.env.NODE_ENV)
  console.log('当前目录:', __dirname)
  console.log('应用路径:', app.getAppPath())
  
  // 根据环境加载不同的URL
  let loadUrl
  if (process.env.NODE_ENV === 'development') {
    // 开发模式：加载Vite服务器
    loadUrl = 'http://localhost:3000'
    console.log('开发模式：加载Vite服务器:', loadUrl)
  } else {
    // 生产模式：加载本地HTML文件
    loadUrl = `file://${path.join(__dirname, 'build', 'renderer', 'index.html')}`
    console.log('生产模式：加载本地HTML文件:', loadUrl)
  }
  
  mainWindow.loadURL(loadUrl)

  // 设置 BackgroundTaskService 的 webContents
  const backgroundTaskService = require('./src/main/services/BackgroundTaskService')
  backgroundTaskService.setWebContents(mainWindow.webContents)
  
  // 监听加载失败事件
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('页面加载失败:', errorCode, errorDescription, validatedURL)
  })

  // 移除 console-message 转发（原逻辑会把渲染进程每条 console.log 转发到主进程同步 IO 写文件，
  // 切换会话时大量渲染端日志会阻塞主进程事件循环，拉长 IPC 大对象的 GC 窗口）

  // 监听渲染进程崩溃事件 - 尝试恢复
  mainWindow.webContents.on('render-process-crashed', (event, killed) => {
    console.error('渲染进程崩溃:', killed)
    // 尝试恢复窗口
    if (!mainWindow.isDestroyed()) {
      console.log('尝试重新加载窗口...')
      mainWindow.reload()
    }
  })

  // 监听渲染进程消失事件 - 尝试恢复
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('渲染进程消失:', details.reason, details.exitCode)
    // 如果渲染进程异常退出（非正常关闭），尝试恢复
    if (details.reason !== 'clean-exit' && !mainWindow.isDestroyed()) {
      console.log('渲染进程异常退出，尝试重新加载...')
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.reload()
        }
      }, 500)
    }
  })

  // 监听未捕获的页面错误
  mainWindow.webContents.on('page-failed-to-provisional-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('页面加载失败:', errorCode, errorDescription, validatedURL)
  })
  
  // 监听加载完成事件
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('页面加载完成')
  })

  // 窗口最大化/还原状态变化时通知渲染进程，用于切换自定义控制按钮图标
  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized')
    }
  })
  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:unmaximized')
    }
  })
  
  // 仅在开发环境打开DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    console.log('DevTools已打开')
  }

  // 系统处理器已在导入时自动初始化
}

// 应用准备就绪
app.whenReady().then(async () => {
  // 注册文件协议处理器，以支持相对路径资源加载
  if (process.env.NODE_ENV !== 'development') {
    protocol.interceptFileProtocol('file', (request, callback) => {
      const urlPath = request.url.substr(7) // 去掉 'file://'
      const decodedUrl = decodeURI(urlPath)

      // 如果请求以 /assets 开头，从 build/renderer 目录获取
      if (decodedUrl.includes('assets/')) {
        // 从 /assets/... 中提取 assets/... 部分
        const match = decodedUrl.match(/\/assets\/(.+)/)
        if (match) {
          const filePath = path.normalize(
            path.join(__dirname, 'build', 'renderer', 'assets', match[1])
          )
          console.log('加载资源文件:', filePath)
          callback({ path: filePath })
        } else {
          callback({ path: decodedUrl })
        }
      } else {
        callback({ path: decodedUrl })
      }
    })
  }

  // 先创建窗口，不等待数据库初始化
  console.log('开始创建窗口...')
  await createWindow()
  console.log('窗口创建完成')

  // === Task 1.9：workspace 初始化 + IPC 注册 ===
  // v1.5.3：用 mutable 引用对象 workspaceRefs，后续 task（P1.10 wiki、P5 kg）
  // 注入新实例时只需修改 workspaceRefs.inner 引用，无需重新 register IPC。
  const { WorkspaceManager } = require('./src/main/workspace/WorkspaceManager')
  const { WikiEngine } = require('./src/main/workspace/WikiEngine')
  const { ChatHistoryExporter } = require('./src/main/workspace/ChatHistoryExporter')
  const { ChatHistorySync } = require('./src/main/workspace/ChatHistorySync')
  const workspaceHandler = require('./src/main/ipcHandlers/workspaceHandler')

  const workspaceRefs = { workspaceManager: null, wikiEngine: null, kgExtractor: null, chatHistorySync: null }
  workspaceRefs.workspaceManager = new WorkspaceManager()
  // Task 6：工作区切换 → agent.md 路径切到 <workspacePath>/.agent/agent.md + 老 v1 自动迁移
  workspaceRefs.workspaceManager.on('opened', async newWsPath => {
    try {
      await setAgentMdWorkspacePath(newWsPath)
    } catch (err) {
      console.warn('[main] setAgentMdWorkspacePath 失败:', err.message)
    }
  })
  // Task 2.12-2.15：实例化 ChatHistorySync + ChatHistoryExporter，绑定到 WorkspaceManager
  const chatHistoryExporter = new ChatHistoryExporter()
  workspaceRefs.chatHistorySync = new ChatHistorySync({
    workspace: workspaceRefs.workspaceManager,
    exporter: chatHistoryExporter
  })
  workspaceRefs.workspaceManager.attachSync(workspaceRefs.chatHistorySync)

  // v9.0.0 补充21：初始化工作区路径持久化 store，启动时自动恢复上次工作区
  try {
    const lastWorkspaceStore = require('./src/main/workspace/lastWorkspaceStore')
    lastWorkspaceStore.init(app.getPath('userData'))
    const lastPath = lastWorkspaceStore.get()
    if (lastPath) {
      console.log('[main] 自动恢复上次工作区:', lastPath)
      workspaceRefs.workspaceManager.open(lastPath).catch(err => {
        // 路径不可用（被删除/移动）→ 清空持久化记录，引导用户重新选择
        console.warn('[main] 上次工作区不可用，已清除持久化:', err.message)
        lastWorkspaceStore.clear()
      })
    } else {
      console.log('[main] 无上次工作区记录，启动时显示欢迎页')
    }
  } catch (initErr) {
    console.warn('[main] 初始化 lastWorkspaceStore 失败:', initErr.message)
  }

  // === Task 5.2：实例化 KGExtractor 并注入到 WikiEngine ===
  // v1.5.3 关键：注入到 workspaceRefs（handler 走 refs.kgExtractor 读最新值）
  // + global.kgExtractor（伪 Skill 闭包用 global.*）
  // Task 5.2 (P5.2)：同时把 kgExtractor 注入 WikiEngine，ingest 自动跑 KG 提取
  const { KGExtractor } = require('./src/main/workspace/KGExtractor')
  const { SummaryExtractor } = require('./src/main/workspace/SummaryExtractor')
  let kgSchema = null
  try {
    kgSchema = require('./src/main/workspace/kg-schema.json')
  } catch (_) {
    // kg-schema.json 不存在时 searchGraph 仍可用（extract 才需要 schema）
  }
  const kgExtractor = new KGExtractor({ llmClient: global.deepseekService || null, schema: kgSchema })
  workspaceRefs.kgExtractor = kgExtractor
  global.kgExtractor = kgExtractor
  console.log('[main] KGExtractor 实例化时 llmClient:', global.deepseekService ? 'OK' : 'NULL（待 agentHandler 同步）')

  // 实例化 SummaryExtractor（仅在 main 启动时设置一次，不在 workspace open 回调中覆盖）
  const summaryExtractor = new SummaryExtractor({ deepseekService: global.deepseekService || null })
  console.log('[main] SummaryExtractor 实例化时 deepseekService:', global.deepseekService ? 'OK' : 'NULL（待 agentHandler 同步）')

  // Task 1.10 + Task 5.2：实例化 WikiEngine，注入 workspace 和 kgExtractor + summaryExtractor
  // v8.2.4: 注入 deepseekService 供 readPage 智能分块的 LLM 摘要使用
  workspaceRefs.wikiEngine = new WikiEngine({
    workspace: workspaceRefs.workspaceManager,
    kgExtractor: workspaceRefs.kgExtractor,
    deepseekService: global.deepseekService || null,
    summaryExtractor: summaryExtractor
  })
  workspaceHandler.register(workspaceRefs)
  // v2026-06-29 Task 6：注入视觉能力到 WorkspaceManager（图片拖入自动 OCR + 入 wiki 索引）
  // - SystemService 是单例导出，每次 ingest 时调 getVisionConfig() 拿最新配置再 new VisionService
  const SystemService = require('./src/main/services/SystemService')
  workspaceRefs.workspaceManager.attachVision({
    systemService: SystemService,
    wikiEngine: workspaceRefs.wikiEngine
  })
  // 暴露到全局供其他模块（如 AgentMemoryService / BackgroundTaskService）使用
  global.workspaceManager = workspaceRefs.workspaceManager
  global.wikiEngine = workspaceRefs.wikiEngine
  global.chatHistorySync = workspaceRefs.chatHistorySync
  global.summaryExtractor = summaryExtractor   // 仅在 main 启动时设置一次
  console.log('[main] P5 阶段：KGExtractor + SummaryExtractor 已实例化（searchGraph 启用）')

  // 定时清理 30 天前的老会话（每 24 小时）
  setInterval(async () => {
    try {
      const result = await cleanupOldSessions({ keepDays: 30 })
      if (result.deleted > 0) {
        console.log(`[Cleanup] 清理了 ${result.deleted} 条老消息`)
      }
    } catch (err) {
      console.error('[Cleanup] 失败:', err.message)
    }
  }, 24 * 60 * 60 * 1000)

  // P0：每日幂律衰减（对标 Mneme power-law decay）
  const MemoryTierService = require('./src/main/services/MemoryTierService')
  setInterval(async () => {
    try {
      const result = await MemoryTierService.applyDecay()
      if (result.updated > 0) console.log(`[MemoryDecay] 衰减了 ${result.updated} 条记忆`)
    } catch (err) {
      console.error('[MemoryDecay] 失败:', err.message)
    }
  }, 24 * 60 * 60 * 1000)

  // 重新注册 7 个 workspace 伪 Skill（searchGraph 闭包现在能拿到 kgExtractor）
  try {
    const { getSkillRegistry } = require('./src/main/ipcHandlers/agentHandler')
    const skillRegistry = getSkillRegistry()
    if (skillRegistry) {
      const oldWorkspaceSkillNames = [
        'workspace.search', 'workspace.readPage', 'workspace.ingest',
        'workspace.writeFile', 'workspace.listFiles', 'workspace.lint', 'workspace.searchGraph'
      ]
      for (const name of oldWorkspaceSkillNames) skillRegistry.unregister(name)
      const { buildWorkspaceSkills } = require('./src/main/agent/workspaceTools')
      const newSkills = buildWorkspaceSkills({
        workspaceManager: workspaceRefs.workspaceManager,
        wikiEngine: workspaceRefs.wikiEngine,
        kgExtractor
      })
      for (const s of newSkills) {
        skillRegistry.register(s, { builtin: true, filePath: '<workspace-pseudo>' })
      }
      console.log('[main] P5 阶段：workspace.searchGraph 伪 Skill 已重新注册（含 kgExtractor 闭包）')
    }
  } catch (err) {
    // Skill 系统未初始化时静默忽略（agentHandler.initSkillSystem 会在后续 registerAgentHandlers 里调）
    console.warn('[main] P5 阶段重新注册 workspace 伪 Skill 跳过（skillRegistry 尚未初始化）:', err.message)
  }

  console.log('workspace IPC 已注册（9 个 handler，含 workspace:ingest/migrateSession/exportSession）')

  // 初始化 agent.md 服务（加载 + 监听用户自定义规则文件）
  initAgentMd()

  // 数据库初始化放在后台进行，不阻塞UI
  console.log('数据库初始化开始（后台）...')
  initializeDatabase().then(() => {
    console.log('数据库初始化完成（后台）')
  })

  app.on('activate', async function () {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })

  // 退出前强制 flush 未导出的会话
  app.on('before-quit', async () => {
    if (global.chatHistorySync?.flush) {
      await global.chatHistorySync.flush()
    }
  })
})

// 关闭所有窗口
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// IPC事件处理
ipcMain.on('message', (event, arg) => {
  console.log(arg)
  event.reply('reply', 'pong')
})
