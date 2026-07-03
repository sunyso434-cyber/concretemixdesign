const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  actor: { type: DataTypes.STRING, allowNull: false, defaultValue: 'ai' },
  action: { type: DataTypes.STRING, allowNull: false },        // CONFIRM / UPDATE / DELETE / CREATE
  targetType: { type: DataTypes.STRING, allowNull: false },   // mix_design / basic_mix
  targetId: { type: DataTypes.INTEGER, allowNull: false },
  targetName: { type: DataTypes.STRING, allowNull: true },
  before: { type: DataTypes.TEXT, allowNull: true },
  after: { type: DataTypes.TEXT, allowNull: true },
  userIntent: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'auditLogs',
  timestamps: false,  // 用自己的 timestamp 字段，不用 createdAt/updatedAt
  indexes: [
    { fields: ['targetType', 'targetId'] },
    { fields: ['timestamp'] }
  ]
})

module.exports = AuditLog
