const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  return sequelize.define('ChatSession', {
    sessionId: { type: DataTypes.STRING, primaryKey: true },
    sessionName: { type: DataTypes.STRING },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    lastActivity: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    // v1.5.3 工作区路径（用于多工作区会话隔离）
    workspacePath: { type: DataTypes.STRING(1000), allowNull: true }
  }, {
    tableName: 'ChatSession',
    timestamps: true,
    updatedAt: false
  })
}
