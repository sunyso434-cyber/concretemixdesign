'use strict'

const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

// L1 归档记忆：会话摘要表（参考 MemGPT archival + Mneme power-law decay）
const SessionSummary = sequelize.define('SessionSummary', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sessionId: { type: DataTypes.STRING, allowNull: false },
  rangeStart: { type: DataTypes.INTEGER, allowNull: false },
  rangeEnd: { type: DataTypes.INTEGER, allowNull: false },
  summary: { type: DataTypes.TEXT, allowNull: false },
  // [借鉴 Mneme] 关键决策列表（JSON 数组）
  keyDecisions: { type: DataTypes.JSON, allowNull: true },
  // 关联的工具调用
  toolCalls: { type: DataTypes.JSON, allowNull: true },
  // [借鉴 Mneme] 召回次数（用于幂律衰减计算）
  recallCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastRecalledAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
  // [借鉴 Mneme] 衰减分（每次召回或创建时初始化，按幂律更新）
  decayScore: { type: DataTypes.REAL, defaultValue: 1.0 }
}, {
  tableName: 'session_summaries',
  indexes: [
    { fields: ['sessionId'] },
    { fields: ['decayScore'] }
  ],
  // 模型自带的 FTS5 索引（让 sequelize.sync() 也创建 FTS 虚拟表 + triggers）
  hooks: {
    afterSync: async () => {
      await sequelize.query(`
        CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts USING fts5(
          summary, key_decisions_unfolded,
          content='session_summaries', content_rowid='id',
          tokenize='unicode61 remove_diacritics 2'
        )
      `)
      await sequelize.query(`
        CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
          INSERT INTO session_summaries_fts(rowid, summary, key_decisions_unfolded)
          VALUES (new.id, new.summary, '');
        END
      `)
      await sequelize.query(`
        CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
          INSERT INTO session_summaries_fts(session_summaries_fts, rowid, summary, key_decisions_unfolded)
          VALUES ('delete', old.id, old.summary, '');
        END
      `)
    }
  }
})

module.exports = SessionSummary
