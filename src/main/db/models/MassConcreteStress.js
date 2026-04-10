const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteStress = sequelize.define('MassConcreteStress', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  external_constraint_type: {
    type: DataTypes.STRING,
    comment: '外部约束类型 如：地基约束、一面散热等'
  },
  cx_value: {
    type: DataTypes.FLOAT,
    comment: '约束系数 Cx'
  },
  self_constraint_stress: {
    type: DataTypes.JSON,
    comment: '自约束应力数据'
  },
  external_constraint_stress: {
    type: DataTypes.JSON,
    comment: '外约束应力数据'
  },
  total_stress: {
    type: DataTypes.JSON,
    comment: '总应力数据'
  },
  crack_resistance_check: {
    type: DataTypes.JSON,
    comment: '抗裂验算结果'
  },
  tensile_strength_curve: {
    type: DataTypes.JSON,
    comment: '抗拉强度曲线数据'
  }
}, {
  tableName: 'mass_concrete_stresses',
  timestamps: true
})

module.exports = MassConcreteStress