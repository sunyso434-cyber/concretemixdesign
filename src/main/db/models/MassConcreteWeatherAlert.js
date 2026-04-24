const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteWeatherAlert = sequelize.define('MassConcreteWeatherAlert', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schemeId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  alertType: {
    type: DataTypes.ENUM('wind', 'cold_wave', 'rain'),
    allowNull: false,
    comment: '预警类型'
  },
  alertLevel: {
    type: DataTypes.ENUM('green', 'yellow', 'orange', 'red'),
    allowNull: false,
    comment: '预警等级'
  },
  message: {
    type: DataTypes.TEXT,
    comment: '预警消息'
  }
}, {
  tableName: 'massConcreteWeatherAlerts',
  timestamps: true
})

module.exports = MassConcreteWeatherAlert