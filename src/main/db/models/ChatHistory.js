const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const ChatHistory = sequelize.define('ChatHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sessionId: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  toolCallId: { type: DataTypes.STRING, allowNull: true },
  toolCalls: { type: DataTypes.JSON },
  metadata: { type: DataTypes.JSON },
  // 新增：'aborted' 表示用户主动中止（区别于 error）
  // 注意：不加索引 — 只有 null 和 'aborted' 两个值，区分度太低
  stopReason: { type: DataTypes.STRING(32), allowNull: true }
}, {
  tableName: 'chat_history',
  timestamps: true,
  indexes: [
    { fields: ['sessionId'] },
    { fields: ['createdAt'] }
  ]
})

module.exports = ChatHistory
