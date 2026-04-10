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
  }
}, {
  tableName: 'massConcreteStresses',
  timestamps: true
})

module.exports = MassConcreteStress