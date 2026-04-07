const { Sequelize } = require('sequelize')
const path = require('path')

// 在 Electron 环境中使用 app.getPath('userData')，否则回退到项目目录下的 data 子目录
let userDataPath
try {
  // 尝试加载 electron（在非 Electron 环境会抛出）
  const { app } = require('electron')
  userDataPath = app && app.getPath ? app.getPath('userData') : null
} catch (e) {
  userDataPath = null
}

if (!userDataPath) {
  // 优先使用环境变量，其次回退到当前工作目录下的 data 文件夹
  userDataPath = process.env.USER_DATA_PATH || process.env.APPDATA || path.join(process.cwd(), 'data')
}

// 数据库文件路径
const dbPath = path.join(userDataPath, 'concrete-mixdesign.db')

// 确保目录存在
const fs = require('fs')
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

// 创建Sequelize实例，使用sqlite3
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
})

// 导出sequelize实例
module.exports = { sequelize }