const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const ChatHistory = sequelize.define('ChatHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sessionId: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  toolCalls: { type: DataTypes.JSON },
  metadata: { type: DataTypes.JSON }
}, {
  tableName: 'chat_history',
  timestamps: true,
  indexes: [
    { fields: ['sessionId'] },
    { fields: ['createdAt'] }
  ]
})

module.exports = ChatHistory
