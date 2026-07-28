const { Sequelize, DataTypes } = require('sequelize')
const fs = require('fs')
const path = require('path')
const { runSchemaBaseline } = require('./schemaMigrator')

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
  const basePath = process.env.USER_DATA_PATH || process.env.APPDATA || path.join(process.cwd(), 'data')
  // Electron app.getPath('userData') 会返回 <Roaming>/concrete-mixdesign，
  // 非 Electron 环境需手动补上这个子目录以保持路径一致
  userDataPath = path.join(basePath, 'concrete-mixdesign')
}

// 数据库文件路径
const dbPath = path.join(userDataPath, 'concrete-mixdesign.db')

// 确保目录存在
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
const PumpingFeeItem = require('./models/PumpingFeeItem')
const SalesQuoteHistory = require('./models/SalesQuoteHistory')
const AppSetting = require('./models/AppSetting')
const ChatHistory = require('./models/ChatHistory')
const UserPreference = require('./models/UserPreference')
const CorrectionRule = require('./models/CorrectionRule')
const AuditLog = require('./models/AuditLog')
const SessionSummary = require('./models/SessionSummary')
const PreferenceSuggestion = require('./models/PreferenceSuggestion')
const MaterialBatch = require('./models/MaterialBatch')

// ChatSession 是工厂函数模型（需传入 sequelize），其他模型已自加载 sequelize
const ChatSessionModel = require('./models/ChatSession')
const ChatSession = ChatSessionModel(sequelize)

// 关联：ChatSession 1 - N ChatHistory
// constraints: false —— 不在 DB 层强制外键，因为 chat_history 是先于 ChatSession 写入的
ChatSession.hasMany(ChatHistory, { foreignKey: 'sessionId', sourceKey: 'sessionId', constraints: false })
ChatHistory.belongsTo(ChatSession, { foreignKey: 'sessionId', targetKey: 'sessionId', constraints: false })

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
async function recreateFtsTable(tableName, createSql, triggerSqlList) {
  await sequelize.query(`DROP TRIGGER IF EXISTS ${tableName}_ai`)
  await sequelize.query(`DROP TRIGGER IF EXISTS ${tableName}_au`)
  await sequelize.query(`DROP TRIGGER IF EXISTS ${tableName}_ad`)
  if (tableName === 'session_summaries_fts') {
    await sequelize.query('DROP TRIGGER IF EXISTS session_summaries_ai')
    await sequelize.query('DROP TRIGGER IF EXISTS session_summaries_au')
    await sequelize.query('DROP TRIGGER IF EXISTS session_summaries_ad')
  }
  await sequelize.query(`DROP TABLE IF EXISTS ${tableName}`)
  await sequelize.query(createSql)
  for (const sql of triggerSqlList) {
    await sequelize.query(sql)
  }
}

// ponytail: 存量库补 archived 列。baseline 只在首次 alter，之后 model 新增列不会自动落库，
// 故用 PRAGMA 幂等检测；将来若引入统一迁移框架可替换此处。
async function ensureArchivedColumn() {
  try {
    const cols = await sequelize.query("PRAGMA table_info('ChatSession')", {
      type: sequelize.QueryTypes.SELECT
    })
    const has = cols.some(c => c.name === 'archived')
    if (!has) {
      await sequelize.query("ALTER TABLE `ChatSession` ADD COLUMN `archived` BOOLEAN NOT NULL DEFAULT 0")
      console.log('[schema] ChatSession.archived 列已补充')
    }
  } catch (err) {
    console.warn('[schema] ensureArchivedColumn 失败（忽略，继续启动）:', err.message)
  }
}

async function ensureMemoryFts() {
  const [summaryInfo] = await sequelize.query("PRAGMA table_info('session_summaries_fts')")
  const summaryColumns = summaryInfo.map(col => col.name)
  const needsSummaryRebuild = !summaryColumns.includes('summary') || !summaryColumns.includes('key_decisions')
  if (needsSummaryRebuild) {
    await recreateFtsTable(
      'session_summaries_fts',
      `CREATE VIRTUAL TABLE session_summaries_fts USING fts5(summary, key_decisions, tokenize='unicode61 remove_diacritics 2')`,
      [
        `CREATE TRIGGER session_summaries_fts_ai AFTER INSERT ON session_summaries BEGIN INSERT INTO session_summaries_fts(rowid, summary, key_decisions) VALUES (new.id, new.summary, COALESCE(new.keyDecisions, '')); END`,
        `CREATE TRIGGER session_summaries_fts_au AFTER UPDATE ON session_summaries BEGIN DELETE FROM session_summaries_fts WHERE rowid = old.id; INSERT INTO session_summaries_fts(rowid, summary, key_decisions) VALUES (new.id, new.summary, COALESCE(new.keyDecisions, '')); END`,
        `CREATE TRIGGER session_summaries_fts_ad AFTER DELETE ON session_summaries BEGIN DELETE FROM session_summaries_fts WHERE rowid = old.id; END`
      ]
    )
    await sequelize.query(`INSERT INTO session_summaries_fts(rowid, summary, key_decisions) SELECT id, summary, COALESCE(keyDecisions, '') FROM session_summaries`)
  }

  const [chatInfo] = await sequelize.query("PRAGMA table_info('chat_history_fts')")
  const chatColumns = chatInfo.map(col => col.name)
  const needsChatRebuild = !chatColumns.includes('content') || !chatColumns.includes('sessionId')
  if (needsChatRebuild) {
    await recreateFtsTable(
      'chat_history_fts',
      `CREATE VIRTUAL TABLE chat_history_fts USING fts5(sessionId, role, content, tokenize='unicode61 remove_diacritics 2')`,
      [
        `CREATE TRIGGER chat_history_fts_ai AFTER INSERT ON chat_history BEGIN INSERT INTO chat_history_fts(rowid, sessionId, role, content) VALUES (new.id, new.sessionId, new.role, new.content); END`,
        `CREATE TRIGGER chat_history_fts_au AFTER UPDATE ON chat_history BEGIN DELETE FROM chat_history_fts WHERE rowid = old.id; INSERT INTO chat_history_fts(rowid, sessionId, role, content) VALUES (new.id, new.sessionId, new.role, new.content); END`,
        `CREATE TRIGGER chat_history_fts_ad AFTER DELETE ON chat_history BEGIN DELETE FROM chat_history_fts WHERE rowid = old.id; END`
      ]
    )
    await sequelize.query(`INSERT INTO chat_history_fts(rowid, sessionId, role, content) SELECT id, sessionId, role, content FROM chat_history`)
  }
}

async function syncModels() {
  // UserPreference 已在阶段 B 迁移中废弃，不在此处注册
  const allModels = [Material, MixDesign, SystemParam, OptimizationHistory, InsulationMaterial, PumpingFeeItem, SalesQuoteHistory, AppSetting, ChatHistory, CorrectionRule, ChatSession, AuditLog, SessionSummary, PreferenceSuggestion, MaterialBatch]
  await runSchemaBaseline({ sequelize, models: allModels, dbPath })
  await ensureArchivedColumn()
  await ensureMemoryFts()

  // 审查 P7：为 material_batches.materialId 创建索引
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_material_batches_materialId ON material_batches (materialId)')

  // FTS5 表的创建已统一交给 ensureMemoryFts()（覆盖旧库残留的 key_decisions_unfolded 字段）
  // SessionSummary.js 的 afterSync hook 也会幂等重建，两处保持一致

  console.log('数据库模型同步完成')

  // 初始化默认"水"材料
  try {
    const existingWater = await Material.findOne({ where: { type: '其他', name: '水' } })
    if (!existingWater) {
      await Material.create({
        name: '水',
        type: '其他',
        density: 1000,
        price: 0,
        isSystem: true,
        notes: '系统默认水材料，用于配合比保存'
      })
      console.log('默认水材料已初始化')
    }
  } catch (error) {
    console.error('默认水材料初始化失败:', error.message)
  }

  // 检查并初始化默认保温材料
  const count = await InsulationMaterial.count()
  if (count === 0) {
    await InsulationMaterial.bulkCreate(defaultInsulationMaterials)
    console.log('默认保温材料数据已初始化')
  }

  // v10.10: 销售报价规则表已删除,不再初始化默认规则
  // 改用 reverse_sales_quote / forward_sales_quote Skill 内置默认值

  // 检查并初始化默认泵送费清单
  try {
    const { DEFAULT_PUMPING_FEE_ITEMS } = require('./models/PumpingFeeItem')
    const count = await PumpingFeeItem.count()
    if (count === 0) {
      await PumpingFeeItem.bulkCreate(DEFAULT_PUMPING_FEE_ITEMS)
      console.log('默认泵送费清单已初始化')
    }
  } catch (error) {
    console.error('默认泵送费清单初始化失败:', error)
  }
}

// 导出sequelize实例、关闭函数、同步函数和所有模型
module.exports.closeAllConnections = closeAllConnections
module.exports.syncModels = syncModels
module.exports.ensureArchivedColumn = ensureArchivedColumn
module.exports.Material = Material
module.exports.MixDesign = MixDesign
module.exports.SystemParam = SystemParam
module.exports.OptimizationHistory = OptimizationHistory
module.exports.InsulationMaterial = InsulationMaterial
module.exports.PumpingFeeItem = PumpingFeeItem
module.exports.SalesQuoteHistory = SalesQuoteHistory
module.exports.AppSetting = AppSetting
module.exports.ChatHistory = ChatHistory
module.exports.UserPreference = UserPreference
module.exports.CorrectionRule = CorrectionRule
module.exports.ChatSession = ChatSession
module.exports.AuditLog = AuditLog
module.exports.SessionSummary = SessionSummary
module.exports.PreferenceSuggestion = PreferenceSuggestion
module.exports.MaterialBatch = MaterialBatch
