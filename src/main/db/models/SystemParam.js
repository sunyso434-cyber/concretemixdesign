const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const SystemParam = sequelize.define('SystemParam', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  paramName: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  paramValue: {
    type: DataTypes.STRING,
    allowNull: false
  },
  paramType: {
    type: DataTypes.STRING
  },
  description: {
    type: DataTypes.TEXT
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: '正常'
  }
}, {
  tableName: 'systemParams',
  timestamps: true
})

module.exports = SystemParam
