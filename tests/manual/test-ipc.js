const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { sequelize } = require('../../src/main/db/database')
const MixDesign = require('../../src/main/db/models/MixDesign')

// 初始化数据库
async function initDatabase() {
  try {
    await sequelize.authenticate()
    console.log('数据库连接成功')
    await sequelize.sync({ alter: true })
    console.log('数据库表同步完成')
    
    // 创建测试方案
    const testScheme = await MixDesign.create({
      name: 'IPC测试方案',
      projectName: '测试项目',
      strength: 'C30',
      slump: 80,
      environment: '一般环境',
      waterRatio: 0.45,
      sandRatio: 0.4,
      density: 2400,
      materials: {
        cement: 300,
        flyAsh: 50,
        sand: 750,
        stone: 1050,
        water: 160,
        superplasticizer: 6
      },
      status: '未验证'
    })
    console.log(`创建测试方案成功，ID: ${testScheme.id}`)
    
  } catch (error) {
    console.error('数据库初始化失败:', error)
  }
}

// 创建测试窗口
function createTestWindow() {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../../src/main/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 加载测试HTML
  window.loadURL(`data:text/html;charset=utf-8,<!DOCTYPE html><html><body>
    <h1>IPC测试</h1>
    <button onclick="testGetAllMixDesigns()">测试获取所有方案</button>
    <div id="result"></div>
    <script>
      async function testGetAllMixDesigns() {
        try {
          const result = await window.electron.ipcRenderer.invoke('getAllMixDesigns')
          document.getElementById('result').innerHTML = JSON.stringify(result, null, 2)
          console.log('测试结果:', result)
        } catch (error) {
          document.getElementById('result').innerHTML = '错误: ' + error.message
          console.error('测试失败:', error)
        }
      }
    </script>
  </body></html>`)

  window.webContents.openDevTools()
}

// 注册IPC处理器
ipcMain.handle('getAllMixDesigns', async () => {
  try {
    console.log('IPC: 获取所有方案')
    const mixDesigns = await MixDesign.findAll()
    console.log(`IPC: 找到 ${mixDesigns.length} 个方案`)
    return { success: true, data: mixDesigns }
  } catch (error) {
    console.error('IPC: 获取方案失败:', error)
    return { success: false, error: error.message }
  }
})

// 启动应用
app.whenReady().then(async () => {
  await initDatabase()
  createTestWindow()
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createTestWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
