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
  hydrationRateCoefficient: {
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
    comment: '里表温差曲线数据'
  },
  surfaceTempDiffCurveData: {
    type: DataTypes.JSON,
    comment: '表气温温曲线数据'
  },
  tempDistributionData: {
    type: DataTypes.JSON,
    comment: '温度分布数据'
  },
  tempFieldData: {
    type: DataTypes.JSON,
    comment: '温度场数据（时间-位置-温度）'
  }
}, {
  tableName: 'massConcreteAdiabaticTemps',
  timestamps: true
})

module.exports = MassConcreteAdiabaticTemp