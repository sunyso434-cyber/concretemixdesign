'use strict'

const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

// 自动长期用户画像（对标 Mem0 4 类记忆 + TencentDB L3 + Mneme decay）
// type: 'material' / 'method' / 'correction'
// status: 'pending' / 'accepted' / 'rejected'
const PreferenceSuggestion = sequelize.define('PreferenceSuggestion', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  type: { type: DataTypes.STRING, allowNull: false },
  payload: { type: DataTypes.JSON, allowNull: false },
  confidence: { type: DataTypes.REAL, allowNull: false },
  // [借鉴 Mneme] 召回次数 + 衰减分
  recallCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  decayScore: { type: DataTypes.REAL, defaultValue: 1.0 },
  status: { type: DataTypes.STRING, defaultValue: 'pending' }
}, {
  tableName: 'preference_suggestions',
  indexes: [
    { fields: ['status'] },
    { fields: ['type'] },
    { fields: ['decayScore'] }
  ]
})

module.exports = PreferenceSuggestion
