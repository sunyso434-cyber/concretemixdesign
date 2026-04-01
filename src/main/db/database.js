const { Sequelize } = require('sequelize')
const path = require('path')
const { app } = require('electron')

// 使用用户数据目录，确保数据库文件在应用数据文件夹中
const userDataPath = app.getPath('userData')
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