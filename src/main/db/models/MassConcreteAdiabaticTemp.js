const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteAdiabaticTemp = sequelize.define('MassConcreteAdiabaticTemp', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  molding_temp: {
    type: DataTypes.FLOAT,
    comment: '入模温度 ℃'
  },
  ambient_temp: {
    type: DataTypes.FLOAT,
    comment: '环境温度 ℃'
  },
  concrete_thickness: {
    type: DataTypes.FLOAT,
    comment: '混凝土厚度 m'
  },
  concrete_length: {
    type: DataTypes.FLOAT,
    comment: '混凝土长度 m'
  },
  m_coefficient: {
    type: DataTypes.FLOAT,
    comment: 'M系数'
  },
  max_adiabatic_temp: {
    type: DataTypes.FLOAT,
    comment: '最高绝热温升 ℃'
  },
  temp_curve_data: {
    type: DataTypes.JSON,
    comment: '温度曲线数据'
  },
  temp_diff_curve_data: {
    type: DataTypes.JSON,
    comment: '温差曲线数据'
  }
}, {
  tableName: 'mass_concrete_adiabatic_temps',
  timestamps: true
})

module.exports = MassConcreteAdiabaticTemp