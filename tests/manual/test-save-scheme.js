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
    <h1>测试方案保存</h1>
    <button onclick="testSaveScheme()">测试保存方案</button>
    <div id="result"></div>
    <script>
      async function testSaveScheme() {
        try {
          console.log('开始测试保存方案...')
          const testScheme = {
            name: '测试方案',
            projectName: '测试项目',
            description: '测试方案描述',
            strength: 'C30',
            slump: 120,
            environment: '1',
            waterRatio: 0.45,
            sandRatio: 0.4,
            density: 2400,
            materials: {
              cement: 300,
              flyAsh: 50,
              slag: 0,
              sand: 750,
              stone: 1050,
              water: 160,
              superplasticizer: 6
            },
            materialCosts: {
              cement: 120,
              flyAsh: 20,
              sand: 30,
              stone: 40,
              superplasticizer: 10
            },
            totalCost: 220,
            materialDetails: {
              cement: { id: 1, name: 'P.O 42.5R水泥', type: '水泥' },
              flyAsh: { id: 3, name: 'I级粉煤灰', type: '粉煤灰' },
              sand: { id: 7, name: '机制砂', type: '细骨料' },
              stone: { id: 9, name: '碎石', type: '粗骨料' },
              superplasticizer: { id: 11, name: '聚羧酸减水剂', type: '减水剂' }
            },
            status: '未验证'
          }
          
          console.log('测试方案数据:', testScheme)
          
          const result = await window.electronAPI.invoke('createMixDesign', testScheme)
          console.log('保存结果:', result)
          document.getElementById('result').innerHTML = JSON.stringify(result, null, 2)
        } catch (error) {
          console.error('测试失败:', error)
          document.getElementById('result').innerHTML = '错误: ' + error.message
        }
      }
    </script>
  </body></html>`)

  window.webContents.openDevTools()
}

// 注册IPC处理器
ipcMain.handle('createMixDesign', async (_, data) => {
  try {
    console.log('接收到的方案数据:', {
      hasMaterialDetails: !!data.materialDetails,
      hasMaterialCosts: !!data.materialCosts,
      hasTotalCost: !!data.totalCost,
      materialDetailsKeys: data.materialDetails ? Object.keys(data.materialDetails) : [],
      materialCostsKeys: data.materialCosts ? Object.keys(data.materialCosts) : []
    })
    
    const mixDesign = await MixDesign.create(data)
    console.log('创建的方案:', mixDesign)
    return { success: true, data: mixDesign }
  } catch (error) {
    console.error('创建方案失败:', error)
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
