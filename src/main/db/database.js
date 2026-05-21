const { Sequelize, DataTypes } = require('sequelize')
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

// 立即将sequelize附加到module.exports（解决循环依赖：models导入时能获取到sequelize）
module.exports.sequelize = sequelize

// 关闭所有连接（用于恢复数据库后刷新连接）
async function closeAllConnections() {
  try {
    const pool = sequelize.connectionManager.getConnection()
    if (pool && pool.close) {
      pool.close()
    }
  } catch (e) {
    // 忽略获取连接池的错误
  }
  // 强制关闭所有连接
  try {
    await sequelize.close()
  } catch (e) {
    // 忽略关闭错误
  }
}

// 导入所有模型
const Material = require('./models/Material')
const MixDesign = require('./models/MixDesign')
const SystemParam = require('./models/SystemParam')
const OptimizationHistory = require('./models/OptimizationHistory')
const InsulationMaterial = require('./models/InsulationMaterial')
const BasicMixDesign = require('./models/BasicMixDesign')
const SalesQuoteRule = require('./models/SalesQuoteRule')

// 默认保温材料数据
const defaultInsulationMaterials = [
  {
    name: '草袋',
    thermalConductivity: 0.07,
    heatStorageCoefficient: 9.0,
    thickness: 30,
    unitPrice: 5.0,
    remarks: '草袋保温，常规做法',
    isDefault: true
  },
  {
    name: '泡沫板',
    thermalConductivity: 0.035,
    heatStorageCoefficient: 3.0,
    thickness: 20,
    unitPrice: 15.0,
    remarks: '聚苯乙烯泡沫板，保温效果好',
    isDefault: true
  },
  {
    name: '棉被',
    thermalConductivity: 0.06,
    heatStorageCoefficient: 7.0,
    thickness: 25,
    unitPrice: 8.0,
    remarks: '毛毡保温被',
    isDefault: true
  },
  {
    name: '木模板',
    thermalConductivity: 0.20,
    heatStorageCoefficient: 15.0,
    thickness: 18,
    unitPrice: 30.0,
    remarks: '木模板散热',
    isDefault: true
  },
  {
    name: '钢模板',
    thermalConductivity: 50.0,
    heatStorageCoefficient: 200.0,
    thickness: 5,
    unitPrice: 80.0,
    remarks: '钢模板，散热快',
    isDefault: true
  },
  {
    name: '砂层',
    thermalConductivity: 0.50,
    heatStorageCoefficient: 10.0,
    thickness: 100,
    unitPrice: 3.0,
    remarks: '砂层保温',
    isDefault: true
  }
]

// 同步所有模型并初始化数据
async function syncModels() {
  // 同步所有模型到数据库，alter: true 会自动添加新列
  await sequelize.sync({ alter: true })
  console.log('数据库模型同步完成')

  // 检查并初始化默认保温材料
  const count = await InsulationMaterial.count()
  if (count === 0) {
    await InsulationMaterial.bulkCreate(defaultInsulationMaterials)
    console.log('默认保温材料数据已初始化')
  }

  // 检查并初始化默认销售报价规则
  try {
    const SalesQuoteRuleService = require('../services/SalesQuoteRuleService')
    await SalesQuoteRuleService.initDefaultRules()
    console.log('销售报价默认规则已初始化')
  } catch (error) {
    console.error('销售报价默认规则初始化失败:', error)
  }
}

// 导出sequelize实例、关闭函数、同步函数和所有模型
module.exports.closeAllConnections = closeAllConnections
module.exports.syncModels = syncModels
module.exports.Material = Material
module.exports.MixDesign = MixDesign
module.exports.SystemParam = SystemParam
module.exports.OptimizationHistory = OptimizationHistory
module.exports.InsulationMaterial = InsulationMaterial
module.exports.BasicMixDesign = BasicMixDesign
module.exports.SalesQuoteRule = SalesQuoteRule