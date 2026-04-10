const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteInsulation = sequelize.define('MassConcreteInsulation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  wind_speed: {
    type: DataTypes.FLOAT,
    comment: '风速 m/s'
  },
  surface_roughness: {
    type: DataTypes.STRING,
    comment: '表面粗糙度类型'
  },
  insulation_layers: {
    type: DataTypes.JSON,
    comment: '保温层配置'
  },
  total_thermal_resistance: {
    type: DataTypes.FLOAT,
    comment: '总热阻 m²·K/W'
  },
  total_heat_transfer: {
    type: DataTypes.FLOAT,
    comment: '总传热系数 W/(m²·K)'
  },
  virtual_thickness: {
    type: DataTypes.FLOAT,
    comment: '虚厚度 m'
  },
  calculated_thickness: {
    type: DataTypes.FLOAT,
    comment: '计算厚度 m'
  },
  surface_temp_diff: {
    type: DataTypes.FLOAT,
    comment: '表面温度差 ℃'
  },
  meets_requirement: {
    type: DataTypes.BOOLEAN,
    comment: '是否满足温控要求'
  }
}, {
  tableName: 'mass_concrete_insulations',
  timestamps: true
})

module.exports = MassConcreteInsulation