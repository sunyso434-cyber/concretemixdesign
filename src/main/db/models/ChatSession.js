const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  return sequelize.define('ChatSession', {
    sessionId: { type: DataTypes.STRING, primaryKey: true },
    sessionName: { type: DataTypes.STRING },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    lastActivity: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'ChatSession',
    timestamps: true,
    updatedAt: false
  })
}
