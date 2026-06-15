const path = require('path')
const fs = require('fs')
const os = require('os')
const { Sequelize, DataTypes } = require('sequelize')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
const dbPath = path.join(tmpDir, 'test.db')

const sequelize = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false })

// 准备 UserPreference 表 + 一些脏数据
const UserPreference = sequelize.define('UserPreference', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.JSON, allowNull: false },
  category: { type: DataTypes.STRING }
}, { tableName: 'user_preferences', timestamps: true })

// logWriter 包装 — 用 raw SQL 写 migration_log 表
const logEntries = []
let logWriter = null

beforeAll(async () => {
  // 准备 migration_log 表（用 raw SQL 建）
  await sequelize.query(`CREATE TABLE IF NOT EXISTS migration_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    appliedAt DATETIME NOT NULL,
    details TEXT
  )`)

  logWriter = {
    async create({ name, appliedAt, details }) {
      logEntries.push({ name, appliedAt, details })
      await sequelize.query(
        'INSERT INTO migration_log (name, appliedAt, details) VALUES (?, ?, ?)',
        { replacements: [name, appliedAt, JSON.stringify(details || {})], type: sequelize.QueryTypes.INSERT }
      )
    }
  }

  await sequelize.sync({ force: true })
  await UserPreference.bulkCreate([
    { key: 'lastSlump', value: 180, category: 'parameter' },
    { key: 'lastSandRatio', value: 0.42, category: 'parameter' },
    { key: 'sandRatioHistory', value: [0.4, 0.42, 0.43], category: 'parameter' },
    { key: 'avgSandRatio', value: 0.42, category: 'parameter' },
    { key: 'lastUsedCementId', value: 1, category: 'material' },
    { key: 'lastUsedFlyAshId', value: 2, category: 'material' },
    { key: 'lastUsedSlagId', value: 3, category: 'material' },
    { key: 'lastUsedSuperplasticizerId', value: 4, category: 'material' }
  ])
})

afterAll(async () => {
  await sequelize.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('迁移脚本 - 数据迁移', () => {
  test('应丢弃 lastSlump/lastSandRatio/sandRatioHistory/avgSandRatio 脏数据', async () => {
    const migration = require('../2026-06-15-deprecate-user-preferences')
    await migration.up({ context: { sequelize, UserPreference, logWriter, dbPath } })
    // 重新查表 — 应已被删表
    const tables = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table' AND name='user_preferences'", { type: sequelize.QueryTypes.SELECT })
    expect(tables).toEqual([])
  })

  test('应写 migration_log 记录 dropped_keys 等', async () => {
    expect(logEntries.length).toBe(1)
    expect(logEntries[0].name).toContain('deprecate-user-preferences')
    expect(logEntries[0].details.dropped_keys).toEqual(
      expect.arrayContaining(['lastSlump', 'lastSandRatio', 'sandRatioHistory', 'avgSandRatio'])
    )
    // 查 raw SQL 表也确认写入
    const [rows] = await sequelize.query('SELECT * FROM migration_log')
    expect(rows.length).toBe(1)
  })

  test('幂等性：第二次执行应跳过', async () => {
    const migration = require('../2026-06-15-deprecate-user-preferences')
    await expect(migration.up({ context: { sequelize, UserPreference, logWriter, dbPath } })).resolves.not.toThrow()
  })
})