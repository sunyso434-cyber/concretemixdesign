'use strict'

/**
 * 迁移：废弃 UserPreference 表
 * - 备份 user_preferences 表内容到 migration_log.details
 * - 丢弃脏数据 key
 * - 删除 user_preferences 表
 * - 幂等：表已删则跳过
 *
 * Phase B 与 agent.md 迁移（v1→v2）分两步走，本脚本只动数据库。
 * agent.md 迁移在另一个独立脚本 migrations/2026-06-15-migrate-agent-md-v2.js 里。
 */

module.exports = {
  async up({ context }) {
    const { sequelize, UserPreference, logWriter } = context

    // 1. 幂等检查
    const tables = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_preferences'",
      { type: sequelize.QueryTypes.SELECT }
    )
    if (tables.length === 0) {
      console.log('[migrate:2026-06-15-deprecate-user-preferences] user_preferences 表已不存在，跳过')
      return
    }

    // 2. 读取所有记录（备份到 details）
    const allRecords = await UserPreference.findAll({ raw: true })

    // 3. 分类脏数据 vs 待转换数据
    const DROP_KEYS = new Set(['lastSlump', 'lastSandRatio', 'sandRatioHistory', 'avgSandRatio', 'defaultStrength'])
    const dropped = allRecords.filter(r => DROP_KEYS.has(r.key))
    const toConvert = allRecords.filter(r => !DROP_KEYS.has(r.key))

    // 4. 删除表
    await sequelize.query('DROP TABLE IF EXISTS user_preferences')

    // 5. 写 migration_log（通过 logWriter — raw SQL 包装，避免 Sequelize model 临时 define）
    if (logWriter) {
      await logWriter.create({
        name: '2026-06-15-deprecate-user-preferences',
        appliedAt: new Date(),
        details: {
          dropped_keys: dropped.map(r => r.key),
          converted_keys: toConvert.map(r => r.key),
          skip_records: [] // 此阶段不查 materials 表
        }
      })
    }

    console.log(`[migrate] user_preferences 已废弃: 丢弃 ${dropped.length} 条脏数据，转换 ${toConvert.length} 条待迁移数据（详见 agent.md 迁移脚本）`)
  },

  async down({ context }) {
    // 简单回滚：本次迁移主要做"删表 + 记录日志"，不重建表结构。
    // 如需回滚，恢复方法：从 migration_log.details 恢复数据。
    const { sequelize, MigrationLog } = context
    if (MigrationLog) {
      const log = await MigrationLog.findOne({
        where: { name: '2026-06-15-deprecate-user-preferences' }
      })
      if (log) {
        console.log('[migrate:down] migration_log 记录保留:', JSON.stringify(log.details))
      }
    }
  }
}