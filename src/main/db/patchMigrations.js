/**
 * 补丁迁移注册表：把 syncModels 内联的 ensureColumn 补丁收敛为命名迁移
 *
 * 设计（阶段 2 方向 A，2026-08-21）：
 * - 复用 runSchemaBaseline 建的 schema_migrations 表记录执行状态（name 为幂等键）
 * - 迁移内容保持幂等：老库列已存在时快速通过并补记录，新库实际执行
 * - 抛错的迁移不写记录，下次启动自动重试（与 MaintenanceScheduler 同思路）
 * - 历史补丁按首次引入版本命名（p01~p09），新 schema 变更一律新增 pXX，不再往 syncModels 堆内联代码
 */
const { ensureColumn } = require('./schemaMigrator')

// v0.8.x：daily_plans.boundMixDesignId NOT NULL → nullable（原 migrateDailyPlansNullableBoundMixDesignId，事务内重建表保留数据）
async function rebuildDailyPlansNullable(sequelize) {
  const cols = await sequelize.query('PRAGMA table_info(daily_plans)', { type: sequelize.QueryTypes.SELECT })
  const col = cols.find(c => c.name === 'boundMixDesignId')
  if (!col || col.notnull === 0) return  // 已是 nullable，跳过

  console.log('[migration] daily_plans.boundMixDesignId NOT NULL → nullable ...')
  const t = await sequelize.transaction()
  try {
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
    await sequelize.query(`
      INSERT INTO \`daily_plans_new\`
      SELECT \`id\`, \`planDate\`, \`projectName\`, \`constructionUnit\`, \`pourLocation\`,
             \`receiveMethod\`, \`strengthGrade\`, \`volume\`, \`branchId\`, \`plannedSendTime\`,
             \`equipmentInfo\`, \`expectedDuration\`, \`boundMixDesignId\`, \`remarks\`,
             \`createdAt\`, \`updatedAt\`
      FROM \`daily_plans\`
    `, { transaction: t })
    await sequelize.query('DROP TABLE \`daily_plans\`', { transaction: t })
    await sequelize.query('ALTER TABLE \`daily_plans_new\` RENAME TO \`daily_plans\`', { transaction: t })
    // 重建索引（旧索引随 DROP TABLE 一起删除）
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
    throw e
  }
}

const PATCH_MIGRATIONS = [
  {
    // 原 ensureArchivedColumn：存量库补 archived 列（baseline 后 model 新增列不自动落库）
    name: '2026-08-21-p01-chatsession-archived',
    up: async (sequelize) => {
      const cols = await sequelize.query("PRAGMA table_info('ChatSession')", { type: sequelize.QueryTypes.SELECT })
      if (!cols.some(c => c.name === 'archived')) {
        await sequelize.query("ALTER TABLE `ChatSession` ADD COLUMN `archived` BOOLEAN NOT NULL DEFAULT 0")
        console.log('[migration] ChatSession.archived 列已补充')
      }
    }
  },
  {
    // v0.8.1：分公司绑定C30基准配合比（老库补列）
    name: '2026-08-21-p02-capacity-configs-c30-column',
    up: async (sequelize) => {
      await ensureColumn(sequelize, 'capacity_configs', 'c30BaselineMixDesignId', 'INTEGER')
    }
  },
  {
    // A3：materials.currentBatchId + material_batches.materialId 索引（审查 P7）
    name: '2026-08-21-p03-materials-current-batch-id',
    up: async (sequelize) => {
      await ensureColumn(sequelize, 'materials', 'currentBatchId', 'INTEGER')
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_material_batches_materialId ON material_batches (materialId)')
    }
  },
  {
    // v0.0.10：material_batches 补 supplier/quantity（模型此前缺失导致保存丢失）
    name: '2026-08-21-p04-material-batches-supplier-quantity',
    up: async (sequelize) => {
      await ensureColumn(sequelize, 'material_batches', 'supplier', 'TEXT')
      await ensureColumn(sequelize, 'material_batches', 'quantity', 'FLOAT')
    }
  },
  {
    // v0.0.13：trial_test_records 补7种材料用量字段（完整用量表展示）
    name: '2026-08-21-p05-trial-test-records-usage-columns',
    up: async (sequelize) => {
      await ensureColumn(sequelize, 'trial_test_records', 'fly_ash_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'slag_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'lithium_slag_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'composite_powder_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'sand_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'stone_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'superplasticizer_amount', 'FLOAT')
    }
  },
  {
    // v0.0.14：trial_test_records 砂/石拆分为砂1/砂2/石1/石2（砂2/石2允许为空）
    name: '2026-08-21-p06-trial-test-records-sand-stone-split',
    up: async (sequelize) => {
      await ensureColumn(sequelize, 'trial_test_records', 'sand1_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'sand2_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'stone1_amount', 'FLOAT')
      await ensureColumn(sequelize, 'trial_test_records', 'stone2_amount', 'FLOAT')
    }
  },
  {
    // v0.6.0 Task 1.12：幂等键字段（断点续跑重跑同一 tool_call 时防重复写入）
    name: '2026-08-21-p07-idempotency-request-id',
    up: async (sequelize) => {
      await ensureColumn(sequelize, 'auditLogs', 'requestId', 'TEXT')
      await ensureColumn(sequelize, 'salesQuoteHistories', 'requestId', 'TEXT')
    }
  },
  {
    // v0.8.x bugfix：daily_plans.boundMixDesignId 老库 NOT NULL 重建为允许 NULL
    // 否则 create 计划传 NULL 触发约束失败，被误报为"计划重复"(E-PLAN-002)
    name: '2026-08-21-p08-daily-plans-nullable-bound-id',
    up: async (sequelize) => {
      await rebuildDailyPlansNullable(sequelize)
    }
  },
  {
    // 单字段性能索引（复合唯一索引已由 model indexes 定义，不重复建）
    name: '2026-08-21-p09-performance-indexes',
    up: async (sequelize) => {
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_plans (planDate)')
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_vehicle_details_planId ON vehicle_details (planId)')
    }
  }
]

// 按序执行未跑过的补丁迁移；返回 { executed, skipped }
// 注意：不吞错——迁移抛错时直接冒出（启动流程 catch），未执行的迁移下次启动重试
async function runPatchMigrations(sequelize) {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    appliedAt DATETIME NOT NULL,
    details TEXT
  )`)

  let executed = 0
  let skipped = 0
  for (const m of PATCH_MIGRATIONS) {
    const [rows] = await sequelize.query(
      'SELECT name FROM schema_migrations WHERE name = ? LIMIT 1',
      { replacements: [m.name] }
    )
    if (rows.length > 0) {
      skipped++
      continue
    }
    await m.up(sequelize)
    await sequelize.query(
      'INSERT INTO schema_migrations (name, appliedAt, details) VALUES (?, ?, ?)',
      { replacements: [m.name, new Date().toISOString(), JSON.stringify({ type: 'patch' })] }
    )
    executed++
    console.log(`[migration] ${m.name} 完成`)
  }
  return { executed, skipped }
}

module.exports = { PATCH_MIGRATIONS, runPatchMigrations }
