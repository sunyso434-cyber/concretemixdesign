const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteStress = sequelize.define('MassConcreteStress', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schemeId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  externalConstraintType: {
    type: DataTypes.STRING,
    comment: '外部约束类型 如：地基约束、一面散热等'
  },
  cxValue: {
    type: DataTypes.FLOAT,
    comment: '约束系数 Cx'
  },
  selfConstraintStress: {
    type: DataTypes.JSON,
    comment: '自约束应力数据'
  },
  externalConstraintStress: {
    type: DataTypes.JSON,
    comment: '外约束应力数据'
  },
  totalStress: {
    type: DataTypes.JSON,
    comment: '总应力数据'
  },
  crackResistanceCheck: {
    type: DataTypes.JSON,
    comment: '抗裂验算结果'
  },
  tensileStrengthCurve: {
    type: DataTypes.JSON,
    comment: '抗拉强度曲线数据'
  },
  crackRiskIndex: {
    type: DataTypes.FLOAT,
    comment: '裂缝风险指数 0-100'
  },
  riskLevel: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'extreme'),
    comment: '风险等级'
  },
  creepModel: {
    type: DataTypes.ENUM('exponential', 'CEB_FIP_1978'),
    defaultValue: 'exponential',
    comment: '徐变模型选择'
  },
  stressField: {
    type: DataTypes.JSON,
    comment: '应力场分布数据'
  }
}, {
  tableName: 'massConcreteStresses',
  timestamps: true
})

module.exports = MassConcreteStress