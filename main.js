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

const { sequelize } = require('./src/main/db/database')
// 导入IPC处理器
require('./src/main/ipcHandlers/materialHandler')
require('./src/main/ipcHandlers/mixDesignHandler')
require('./src/main/ipcHandlers/mixDesignOptimizerHandler') // 新增：优化器 IPC 处理器
const SystemHandler = require('./src/main/ipcHandlers/systemHandler')
const { autoUpdater } = require('electron-updater')

// 初始化数据库（在后台执行，不阻塞UI）
async function initializeDatabase() {
  try {
    await sequelize.authenticate()
    console.log('数据库连接成功')
    // 初始化数据库表
    const Material = require('./src/main/db/models/Material')
    const MixDesign = require('./src/main/db/models/MixDesign')
    const SystemParam = require('./src/main/db/models/SystemParam')
    require('./src/main/db/models/OptimizationHistory') // 新增：优化历史记录模型
    await sequelize.sync({ force: true })
    console.log('数据库表重建完成')
    // 初始化预设材料
    const MaterialService = require('./src/main/services/MaterialService')
    await MaterialService.initDefaultMaterials()
    // 初始化系统参数
    const SystemService = require('./src/main/services/SystemService')
    await SystemService.initDefaultParams()
    console.log('数据库初始化完成')
  } catch (err) {
    console.error('数据库初始化失败:', err)
  }
}

// 创建窗口
async function createWindow() {
  // 等待数据库初始化完成
  await initializeDatabase()
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'src/main/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

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
  
  // 监听加载失败事件
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('页面加载失败:', errorCode, errorDescription, validatedURL)
  })
  
  // 监听控制台消息
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('渲染进程控制台:', message)
  })
  
  // 监听渲染进程崩溃事件
  mainWindow.webContents.on('render-process-crashed', (event, killed) => {
    console.error('渲染进程崩溃:', killed)
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

  // 配置自动更新
  if (process.env.NODE_ENV === 'production') {
    autoUpdater.checkForUpdatesAndNotify()

    // 自动更新事件监听
    autoUpdater.on('checking-for-update', () => {
      console.log('正在检查更新...')
    })

    autoUpdater.on('update-available', (info) => {
      console.log('发现新版本:', info.version)
      mainWindow.webContents.send('update-available', info)
    })

    autoUpdater.on('update-not-available', (info) => {
      console.log('当前已是最新版本')
    })

    autoUpdater.on('error', (err) => {
      console.error('更新检查失败:', err)
    })

    autoUpdater.on('download-progress', (progressObj) => {
      let log_message = "下载进度: " + progressObj.percent + '%'
      console.log(log_message)
      mainWindow.webContents.send('download-progress', progressObj)
    })

    autoUpdater.on('update-downloaded', (info) => {
      console.log('更新下载完成')
      mainWindow.webContents.send('update-downloaded', info)
      // 自动安装更新
      setTimeout(() => {
        autoUpdater.quitAndInstall()
      }, 5000)
    })
  }
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
  
  // 先初始化数据库，确保表结构创建完成
  console.log('开始初始化数据库...')
  await initializeDatabase()
  console.log('数据库初始化完成')
  
  // 然后创建窗口
  await createWindow()

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
