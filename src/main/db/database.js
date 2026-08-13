const { Sequelize, DataTypes } = require('sequelize')
const fs = require('fs')
const path = require('path')
const { ensureColumn, runSchemaBaseline } = require('./schemaMigrator')

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
const TrialTestRecord = require('./models/TrialTestRecord')
const SecurityLog = require('./models/SecurityLog')
const AgentCheckpoint = require('./models/AgentCheckpoint')

// ChatSession 是工厂函数模型（需传入 sequelize），其他模型已自加载 sequelize
const ChatSessionModel = require('./models/ChatSession')
const ChatSession = ChatSessionModel(sequelize)

// v0.8.0 生产供应计划
const defineDailyPlan = require('./models/DailyPlan')
const defineVehicleDetail = require('./models/VehicleDetail')
const defineCapacityConfig = require('./models/CapacityConfig')
const defineProjectDistance = require('./models/ProjectDistance')

const DailyPlan = defineDailyPlan(sequelize)
const VehicleDetail = defineVehicleDetail(sequelize)
const CapacityConfig = defineCapacityConfig(sequelize)
const ProjectDistance = defineProjectDistance(sequelize)

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

/**
 * v0.8.x bugfix migration：把 daily_plans.boundMixDesignId 从 NOT NULL 改为允许 NULL
 *
 * 背景：v0.8.0 建表时 boundMixDesignId 是 NOT NULL，v0.8.1 废弃此字段（改为分公司绑定），
 * 但 sync(alter:false) 不改列约束。create 计划时不传此字段 → NULL → NOT NULL 约束失败
 * → Sequelize 误报为 SequelizeUniqueConstraintError → DailyPlanService 误报"计划重复"
 *
 * 幂等：检查 boundMixDesignId 列的 notnull 标志，已是 0 则跳过
 * 安全：事务内重建表，保留全部数据和索引
 */
async function migrateDailyPlansNullableBoundMixDesignId(sequelize) {
  const cols = await sequelize.query('PRAGMA table_info(daily_plans)', { type: sequelize.QueryTypes.SELECT })
  const col = cols.find(c => c.name === 'boundMixDesignId')
  if (!col || col.notnull === 0) return  // 已是 nullable，跳过

  console.log('[migration] daily_plans.boundMixDesignId NOT NULL → nullable ...')
  const t = await sequelize.transaction()
  try {
    // 1. 创建新表（boundMixDesignId 允许 NULL）
    await sequelize.query(`
      CREATE TABLE \`daily_plans_new\` (
        \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
        \`planDate\` VARCHAR(255) NOT NULL,
        \`projectName\` VARCHAR(255) NOT NULL,
        \`constructionUnit\` VARCHAR(255),
        \`pourLocation\` VARCHAR(255) NOT NULL,
        \`receiveMethod\` VARCHAR(255),
        \`strengthGrade\` VARCHAR(255) NOT NULL,
        \`volume\` FLOAT NOT NULL,
        \`branchId\` INTEGER NOT NULL,
        \`plannedSendTime\` VARCHAR(255) NOT NULL,
        \`equipmentInfo\` JSON,
        \`expectedDuration\` FLOAT NOT NULL,
        \`boundMixDesignId\` INTEGER,
        \`remarks\` VARCHAR(255),
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NOT NULL
      )
    `, { transaction: t })

    // 2. 复制全部数据
    await sequelize.query(`
      INSERT INTO \`daily_plans_new\`
      SELECT \`id\`, \`planDate\`, \`projectName\`, \`constructionUnit\`, \`pourLocation\`,
             \`receiveMethod\`, \`strengthGrade\`, \`volume\`, \`branchId\`, \`plannedSendTime\`,
             \`equipmentInfo\`, \`expectedDuration\`, \`boundMixDesignId\`, \`remarks\`,
             \`createdAt\`, \`updatedAt\`
      FROM \`daily_plans\`
    `, { transaction: t })

    // 3. 删旧表、重命名新表
    await sequelize.query('DROP TABLE \`daily_plans\`', { transaction: t })
    await sequelize.query('ALTER TABLE \`daily_plans_new\` RENAME TO \`daily_plans\`', { transaction: t })

    // 4. 重建索引（旧索引随 DROP TABLE 一起删除）
    await sequelize.query(
      'CREATE UNIQUE INDEX `daily_plans_plan_date_project_name_pour_location_strength_grade_branch_id` ON `daily_plans` (`planDate`, `projectName`, `pourLocation`, `strengthGrade`, `branchId`)',
      { transaction: t }
    )
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_plans (planDate)',
      { transaction: t }
    )

    await t.commit()
    console.log('[migration] daily_plans.boundMixDesignId 改为 nullable 完成')
  } catch (e) {
    await t.rollback()
    console.error('[migration] daily_plans boundMixDesignId 迁移失败:', e.message)
    throw e
  }
}

async function syncModels() {
  // UserPreference 已在阶段 B 迁移中废弃，不在此处注册
  const allModels = [Material, MixDesign, SystemParam, OptimizationHistory, InsulationMaterial, PumpingFeeItem, SalesQuoteHistory, AppSetting, ChatHistory, CorrectionRule, ChatSession, AuditLog, SessionSummary, PreferenceSuggestion, MaterialBatch, TrialTestRecord, SecurityLog, AgentCheckpoint, DailyPlan, VehicleDetail, CapacityConfig, ProjectDistance]
  await runSchemaBaseline({ sequelize, models: allModels, dbPath })
  await ensureArchivedColumn()
  await ensureMemoryFts()

  // v0.0.9 新增表：基线机制仅处理旧模型，新模型需独立 sync
  // ensureColumn 只能给已有表加列，不能创建全新表
  await MaterialBatch.sync({ alter: false, force: false })
  await TrialTestRecord.sync({ alter: false, force: false })
  await SecurityLog.sync({ alter: false, force: false })
  // v0.4.0：agent_checkpoint 表（断点续跑：todo 快照 + last_step），幂等 sync
  await AgentCheckpoint.sync({ alter: false, force: false })

  // v0.8.0 生产供应计划
  await CapacityConfig.sync({ alter: false, force: false })
  await ProjectDistance.sync({ alter: false, force: false })
  await DailyPlan.sync({ alter: false, force: false })
  await VehicleDetail.sync({ alter: false, force: false })

  // v0.8.x bugfix：daily_plans.boundMixDesignId 老库为 NOT NULL，但 v0.8.1 已废弃此字段（改为分公司绑定）
  // sync(alter:false) 不改列约束，需一次性 migration 重建表把 boundMixDesignId 改为允许 NULL
  // 否则 create 计划时传 NULL 会触发 NOT NULL 约束失败，被误报为"计划重复"(E-PLAN-002)
  await migrateDailyPlansNullableBoundMixDesignId(sequelize)

  // v0.8.1：分公司绑定C30基准配合比（老库补列）
  await ensureColumn(sequelize, 'capacity_configs', 'c30BaselineMixDesignId', 'INTEGER')

  // 单字段性能索引（复合唯一索引已由 model indexes 定义，不重复建）
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_plans (planDate)')
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_vehicle_details_planId ON vehicle_details (planId)')

  // A3：为 materials 表添加 currentBatchId 字段（幂等）
  await ensureColumn(sequelize, 'materials', 'currentBatchId', 'INTEGER')
  // 审查 P7：为 material_batches.materialId 创建索引
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_material_batches_materialId ON material_batches (materialId)')

  // v0.0.10：material_batches 补 supplier/quantity 字段（模型此前缺失，导致保存丢失）
  await ensureColumn(sequelize, 'material_batches', 'supplier', 'TEXT')
  await ensureColumn(sequelize, 'material_batches', 'quantity', 'FLOAT')

  // v0.0.13：trial_test_records 补7种材料用量字段（用于完整用量表展示）
  await ensureColumn(sequelize, 'trial_test_records', 'fly_ash_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'slag_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'lithium_slag_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'composite_powder_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'sand_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'stone_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'superplasticizer_amount', 'FLOAT')

  // v0.0.14：trial_test_records 砂/石拆分为砂1/砂2/石1/石2（砂2/石2允许为空）
  await ensureColumn(sequelize, 'trial_test_records', 'sand1_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'sand2_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'stone1_amount', 'FLOAT')
  await ensureColumn(sequelize, 'trial_test_records', 'stone2_amount', 'FLOAT')

  // v0.6.0 Task 1.12：幂等键字段（断点续跑重跑同一 tool_call 时防重复写入）
  await ensureColumn(sequelize, 'auditLogs', 'requestId', 'TEXT')
  await ensureColumn(sequelize, 'salesQuoteHistories', 'requestId', 'TEXT')

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
module.exports.TrialTestRecord = TrialTestRecord
module.exports.SecurityLog = SecurityLog
module.exports.AgentCheckpoint = AgentCheckpoint
module.exports.DailyPlan = DailyPlan
module.exports.VehicleDetail = VehicleDetail
module.exports.CapacityConfig = CapacityConfig
module.exports.ProjectDistance = ProjectDistance
