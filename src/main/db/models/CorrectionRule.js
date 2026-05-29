const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const CorrectionRule = sequelize.define('CorrectionRule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  context: { type: DataTypes.JSON, allowNull: false },
  originalSuggestion: { type: DataTypes.JSON, allowNull: false },
  userCorrection: { type: DataTypes.JSON, allowNull: false },
  toolName: { type: DataTypes.STRING },
  usageCount: { type: DataTypes.INTEGER, defaultValue: 0 }
}, {
  tableName: 'correction_rules',
  timestamps: true,
  indexes: [
    { fields: ['toolName'] }
  ]
})

module.exports = CorrectionRule
