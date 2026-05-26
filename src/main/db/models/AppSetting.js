const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const AppSetting = sequelize.define('AppSetting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  value: { type: DataTypes.TEXT }
}, {
  tableName: 'appSettings',
  timestamps: true
})

module.exports = AppSetting
