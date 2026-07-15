const fs = require('fs')
const os = require('os')
const path = require('path')
const { DataTypes, Sequelize } = require('sequelize')
const {
  BASELINE_MIGRATION,
  MIGRATION_TABLE,
  runSchemaBaseline
} = require('../../db/schemaMigrator')

describe('schemaMigrator', () => {
  let tmpDir
  let dbPath
  let sequelize

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-migrator-'))
    dbPath = path.join(tmpDir, 'test.db')
    sequelize = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false })
  })

  afterEach(async () => {
    await sequelize.close().catch(() => {})
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('新数据库直接建表并记录基线，不创建无意义备份', async () => {
    const Item = sequelize.define('Item', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false }
    }, { tableName: 'items', timestamps: false })

    const result = await runSchemaBaseline({ sequelize, models: [Item], dbPath, logger: { log: jest.fn() } })

    expect(result).toMatchObject({ applied: true, mode: 'fresh-install', backupPath: null })
    expect(await sequelize.getQueryInterface().describeTable('items')).toHaveProperty('name')
    const [rows] = await sequelize.query(`SELECT name FROM ${MIGRATION_TABLE}`)
    expect(rows).toEqual([{ name: BASELINE_MIGRATION }])
  })

  test('已有数据库先备份，再补齐结构且保留数据', async () => {
    const qi = sequelize.getQueryInterface()
    await qi.createTable('items', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false }
    })
    await qi.bulkInsert('items', [{ name: 'existing-row' }])

    const Item = sequelize.define('Item', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true }
    }, { tableName: 'items', timestamps: false })

    const result = await runSchemaBaseline({ sequelize, models: [Item], dbPath, logger: { log: jest.fn() } })

    expect(result).toMatchObject({ applied: true, mode: 'existing-upgrade' })
    expect(fs.existsSync(result.backupPath)).toBe(true)
    expect(await qi.describeTable('items')).toHaveProperty('note')
    const [rows] = await sequelize.query('SELECT name FROM items')
    expect(rows).toEqual([{ name: 'existing-row' }])

    const backupDb = new Sequelize({ dialect: 'sqlite', storage: result.backupPath, logging: false })
    expect(await backupDb.getQueryInterface().describeTable('items')).not.toHaveProperty('note')
    await backupDb.close()
  })

  test('隔离旧版 alter 遗留的 backup 表后完成升级', async () => {
    const qi = sequelize.getQueryInterface()
    const legacyColumns = {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false }
    }
    await qi.createTable('items', legacyColumns)
    await qi.createTable('items_backup', legacyColumns)
    await qi.bulkInsert('items', [{ id: 1, name: 'current-row' }])
    await qi.bulkInsert('items_backup', [{ id: 1, name: 'stale-backup-row' }])

    const Item = sequelize.define('Item', {
      ...legacyColumns,
      note: { type: DataTypes.TEXT, allowNull: true }
    }, { tableName: 'items', timestamps: false })

    const result = await runSchemaBaseline({
      sequelize,
      models: [Item],
      dbPath,
      logger: { log: jest.fn() }
    })

    expect(result).toMatchObject({ applied: true, mode: 'existing-upgrade' })
    expect(await qi.describeTable('items')).toHaveProperty('note')
    const [currentRows] = await sequelize.query('SELECT id, name FROM items')
    expect(currentRows).toEqual([{ id: 1, name: 'current-row' }])

    const [legacyTables] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'items_legacy_backup_%'"
    )
    expect(legacyTables).toHaveLength(1)
    const [legacyRows] = await sequelize.query(
      `SELECT id, name FROM "${legacyTables[0].name}"`
    )
    expect(legacyRows).toEqual([{ id: 1, name: 'stale-backup-row' }])
  })

  test('已记录基线时不再运行模型 alter', async () => {
    const Item = sequelize.define('Item', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
    }, { tableName: 'items', timestamps: false })
    await runSchemaBaseline({ sequelize, models: [Item], dbPath, logger: { log: jest.fn() } })
    const syncSpy = jest.spyOn(Item, 'sync')

    const result = await runSchemaBaseline({ sequelize, models: [Item], dbPath, logger: { log: jest.fn() } })

    expect(result).toEqual({ applied: false, mode: 'already-applied', backupPath: null })
    expect(syncSpy).not.toHaveBeenCalled()
  })

  test('迁移失败时回滚结构且不记录基线', async () => {
    const qi = sequelize.getQueryInterface()
    await qi.createTable('legacy', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
    })
    const brokenModel = {
      async sync(options) {
        await qi.addColumn('legacy', 'partialColumn', { type: DataTypes.TEXT }, { transaction: options.transaction })
        throw new Error('simulated failure')
      }
    }

    await expect(runSchemaBaseline({
      sequelize,
      models: [brokenModel],
      dbPath,
      logger: { log: jest.fn() }
    })).rejects.toThrow('数据库结构基线失败')

    expect(await qi.describeTable('legacy')).not.toHaveProperty('partialColumn')
    const [migrationTables] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      { replacements: [MIGRATION_TABLE] }
    )
    expect(migrationTables).toHaveLength(0)
    expect(fs.readdirSync(tmpDir).some(name => name.includes('.pre-baseline-'))).toBe(true)
  })
})
