const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const UserPreference = sequelize.define('UserPreference', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.JSON, allowNull: false },
  category: { type: DataTypes.STRING }
}, {
  tableName: 'user_preferences',
  timestamps: true,
  indexes: [
    { fields: ['key'], unique: true }
  ]
})

module.exports = UserPreference
