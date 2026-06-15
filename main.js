const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

// 设置日志文件路径（在 app ready 后获取）
let logFilePath = null
function initLogPath() {
  try {
    logFilePath = path.join(app.getPath('userData'), 'app.log')
  } catch (e) {
    logFilePath = path.join(__dirname, 'app.log')
  }
}

function logToFile(message) {
  if (!logFilePath) initLogPath()
  const timestamp = new Date().toISOString()
  const logLine = `[${timestamp}] ${message}\n`
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf8')
  } catch (e) {
    // 忽略日志写入错误
  }
}

// 覆盖 console.log 以便所有日志都输出到文件
const originalLog = console.log
const originalError = console.error
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
require('./src/main/ipcHandlers/complianceHandler').registerHandlers(ipcMain) // 规范审查 IPC 处理器
require('./src/main/ipcHandlers/agentHandler').registerAgentHandlers() // AI Agent IPC 处理器

// agent.md 用户自定义规则服务（单例，启动时初始化）
const { init: initAgentMd } = require('./src/main/agent/agentMd')

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
  
  // 监听控制台消息
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('渲染进程控制台:', message)
  })
  
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
