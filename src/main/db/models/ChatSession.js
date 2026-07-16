const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  return sequelize.define('ChatSession', {
    sessionId: { type: DataTypes.STRING, primaryKey: true },
    sessionName: { type: DataTypes.STRING },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    lastActivity: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    // v1.5.3 工作区路径（用于多工作区会话隔离）
    workspacePath: { type: DataTypes.STRING(1000), allowNull: true },
    // v10.x 会话归档：true=已归档（从主列表隐藏、只读、仍作为记忆）
    archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'ChatSession',
    timestamps: true,
    updatedAt: false
  })
}
