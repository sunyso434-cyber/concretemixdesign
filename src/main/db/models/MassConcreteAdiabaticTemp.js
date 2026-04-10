const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteAdiabaticTemp = sequelize.define('MassConcreteAdiabaticTemp', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schemeId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  moldingTemp: {
    type: DataTypes.FLOAT,
    comment: '入模温度 ℃'
  },
  ambientTemp: {
    type: DataTypes.FLOAT,
    comment: '环境温度 ℃'
  },
  concreteThickness: {
    type: DataTypes.FLOAT,
    comment: '混凝土厚度 m'
  },
  concreteLength: {
    type: DataTypes.FLOAT,
    comment: '混凝土长度 m'
  },
  mCoefficient: {
    type: DataTypes.FLOAT,
    comment: 'M系数'
  },
  maxAdiabaticTemp: {
    type: DataTypes.FLOAT,
    comment: '最高绝热温升 ℃'
  },
  tempCurveData: {
    type: DataTypes.JSON,
    comment: '温度曲线数据'
  },
  tempDiffCurveData: {
    type: DataTypes.JSON,
    comment: '温差曲线数据'
  }
}, {
  tableName: 'massConcreteAdiabaticTemps',
  timestamps: true
})

module.exports = MassConcreteAdiabaticTemp