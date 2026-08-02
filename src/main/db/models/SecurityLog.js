const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

// 安全/访问日志：登录、配对、连接、远程操作
// 与业务审计 AuditLog 分离：AuditLog 记业务变更，SecurityLog 记访问行为
// 明确不采集 IP：frp 转发后源 IP 恒为 127.0.0.1，无意义；用 deviceId + 时间定位
const SecurityLog = sequelize.define('SecurityLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  event: { type: DataTypes.STRING, allowNull: false },        // auth.login / remote.pair / remote.connect ...
  deviceId: { type: DataTypes.STRING, allowNull: false },     // 设备标识（配对/连接来源）
  detail: { type: DataTypes.TEXT, allowNull: true },
  origin: { type: DataTypes.STRING, allowNull: false },       // 'desktop' | 'remote'
  ok: { type: DataTypes.BOOLEAN, allowNull: false }           // 操作是否成功
}, {
  tableName: 'security_logs',
  timestamps: false,  // 用自己的 timestamp 字段，不用 createdAt/updatedAt
  indexes: [
    { fields: ['timestamp'] }
  ]
})

module.exports = SecurityLog
