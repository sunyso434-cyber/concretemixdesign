'use strict'

const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const SessionSummary = sequelize.define('SessionSummary', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sessionId: { type: DataTypes.STRING, allowNull: false },
  rangeStart: { type: DataTypes.INTEGER, allowNull: false },
  rangeEnd: { type: DataTypes.INTEGER, allowNull: false },
  summary: { type: DataTypes.TEXT, allowNull: false },
  keyDecisions: { type: DataTypes.JSON, allowNull: true },
  toolCalls: { type: DataTypes.JSON, allowNull: true },
  recallCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastRecalledAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
  decayScore: { type: DataTypes.REAL, defaultValue: 1.0 }
}, {
  tableName: 'session_summaries',
  indexes: [
    { fields: ['sessionId'] },
    { fields: ['decayScore'] }
  ],
  hooks: {
    afterSync: async () => {
      await sequelize.query(`
        CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts USING fts5(
          summary, key_decisions,
          tokenize='unicode61 remove_diacritics 2'
        )
      `)
      await sequelize.query(`
        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_ai AFTER INSERT ON session_summaries BEGIN
          INSERT INTO session_summaries_fts(rowid, summary, key_decisions)
          VALUES (new.id, new.summary, COALESCE(new.keyDecisions, ''));
        END
      `)
      await sequelize.query(`
        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_au AFTER UPDATE ON session_summaries BEGIN
          DELETE FROM session_summaries_fts WHERE rowid = old.id;
          INSERT INTO session_summaries_fts(rowid, summary, key_decisions)
          VALUES (new.id, new.summary, COALESCE(new.keyDecisions, ''));
        END
      `)
      await sequelize.query(`
        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_ad AFTER DELETE ON session_summaries BEGIN
          DELETE FROM session_summaries_fts WHERE rowid = old.id;
        END
      `)
    }
  }
})

module.exports = SessionSummary
