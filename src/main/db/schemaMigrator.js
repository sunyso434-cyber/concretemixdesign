const crypto = require('crypto')
const fs = require('fs')

const BASELINE_MIGRATION = '2026-07-15-baseline-v10.10.12'
const MIGRATION_TABLE = 'schema_migrations'

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

async function createVerifiedBackup(sequelize, dbPath) {
  await sequelize.query('PRAGMA wal_checkpoint(FULL)')

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${dbPath}.pre-baseline-${timestamp}.bak`
  fs.copyFileSync(dbPath, backupPath)

  const sourceHash = hashFile(dbPath)
  const backupHash = hashFile(backupPath)
  if (sourceHash !== backupHash) {
    fs.rmSync(backupPath, { force: true })
    throw new Error('数据库备份校验失败，已取消迁移')
  }

  return backupPath
}

async function hasAppliedBaseline(sequelize) {
  const [tables] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    { replacements: [MIGRATION_TABLE] }
  )
  if (tables.length === 0) return false

  const [rows] = await sequelize.query(
    `SELECT name FROM ${MIGRATION_TABLE} WHERE name = ? LIMIT 1`,
    { replacements: [BASELINE_MIGRATION] }
  )
  return rows.length > 0
}

async function listUserTables(sequelize) {
  const [rows] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  )
  return rows.map(row => row.name).filter(name => name !== MIGRATION_TABLE)
}

function getModelTableName(model) {
  const table = typeof model.getTableName === 'function'
    ? model.getTableName()
    : model.tableName
  if (typeof table === 'string') return table
  return typeof table?.tableName === 'string' ? table.tableName : null
}

async function quarantineLegacyAlterBackups(sequelize, models, transaction) {
  const modelTables = [...new Set(models.map(getModelTableName).filter(Boolean))]
  if (modelTables.length === 0) return []

  const [rows] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type='table'",
    { transaction }
  )
  const existingTables = new Set(rows.map(row => row.name))
  const quote = name => sequelize.getQueryInterface().quoteIdentifier(name)
  const suffix = new Date().toISOString().replace(/\D/g, '')
  const quarantined = []

  for (const tableName of modelTables) {
    const source = `${tableName}_backup`
    if (!existingTables.has(source)) continue

    let target = `${tableName}_legacy_backup_${suffix}`
    let sequence = 1
    while (existingTables.has(target)) {
      target = `${tableName}_legacy_backup_${suffix}_${sequence++}`
    }

    await sequelize.query(
      `ALTER TABLE ${quote(source)} RENAME TO ${quote(target)}`,
      { transaction }
    )
    existingTables.delete(source)
    existingTables.add(target)
    quarantined.push({ source, target })
  }

  return quarantined
}

async function runSchemaBaseline({ sequelize, models, dbPath, logger = console }) {
  if (await hasAppliedBaseline(sequelize)) {
    return { applied: false, mode: 'already-applied', backupPath: null }
  }

  const existingTables = await listUserTables(sequelize)
  const isExistingDatabase = existingTables.length > 0
  const backupPath = isExistingDatabase
    ? await createVerifiedBackup(sequelize, dbPath)
    : null

  try {
    await sequelize.transaction(async transaction => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
          name TEXT PRIMARY KEY,
          appliedAt DATETIME NOT NULL,
          details TEXT
        )
      `, { transaction })

      // 旧版 alter 失败时会遗留 <table>_backup；再次 alter 会向其中重复插入主键。
      // 改名隔离而非删除，既让 Sequelize 能创建新临时表，也保留旧表用于追溯。
      const legacyBackupTables = await quarantineLegacyAlterBackups(sequelize, models, transaction)

      for (const model of models) {
        await model.sync({
          alter: isExistingDatabase,
          force: false,
          hooks: false,
          transaction
        })
      }

      await sequelize.query(
        `INSERT INTO ${MIGRATION_TABLE} (name, appliedAt, details) VALUES (?, ?, ?)`,
        {
          replacements: [
            BASELINE_MIGRATION,
            new Date().toISOString(),
            JSON.stringify({
              mode: isExistingDatabase ? 'existing-upgrade' : 'fresh-install',
              legacyBackupTables
            })
          ],
          transaction
        }
      )
    })
  } catch (error) {
    const recoveryHint = backupPath ? `，原始数据库备份位于 ${backupPath}` : ''
    const detail = error.parent?.message || error.original?.message || error.message
    throw new Error(`数据库结构基线失败${recoveryHint}: ${detail}`, { cause: error })
  }

  const mode = isExistingDatabase ? 'existing-upgrade' : 'fresh-install'
  logger.log(`[schema] ${BASELINE_MIGRATION} 已完成 (${mode})`)
  if (backupPath) logger.log(`[schema] 迁移前备份: ${backupPath}`)
  return { applied: true, mode, backupPath }
}

module.exports = {
  BASELINE_MIGRATION,
  MIGRATION_TABLE,
  createVerifiedBackup,
  quarantineLegacyAlterBackups,
  runSchemaBaseline
}
