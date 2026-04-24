const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteInsulation = sequelize.define('MassConcreteInsulation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schemeId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  windSpeed: {
    type: DataTypes.FLOAT,
    comment: '风速 m/s'
  },
  surfaceRoughness: {
    type: DataTypes.STRING,
    comment: '表面粗糙度类型'
  },
  insulationLayers: {
    type: DataTypes.JSON,
    comment: '保温层配置'
  },
  totalThermalResistance: {
    type: DataTypes.FLOAT,
    comment: '总热阻 m²·K/W'
  },
  topInsulationLayers: {
    type: DataTypes.JSON,
    comment: '顶面保温层配置'
  },
  sideInsulationLayers: {
    type: DataTypes.JSON,
    comment: '侧面保温层配置'
  },
  topTempDiff: {
    type: DataTypes.FLOAT,
    comment: '顶面温差计算值'
  },
  sideTempDiff: {
    type: DataTypes.FLOAT,
    comment: '侧面温差计算值'
  },
  bottomBoundaryType: {
    type: DataTypes.STRING,
    comment: '底面边界条件: basement/exposed/heated'
  },
  totalHeatTransfer: {
    type: DataTypes.FLOAT,
    comment: '总传热系数 W/(m²·K)'
  },
  virtualThickness: {
    type: DataTypes.FLOAT,
    comment: '虚厚度 m'
  },
  calculatedThickness: {
    type: DataTypes.FLOAT,
    comment: '计算厚度 m'
  },
  surfaceTempDiff: {
    type: DataTypes.FLOAT,
    comment: '表面温度差 ℃'
  },
  meetsRequirement: {
    type: DataTypes.BOOLEAN,
    comment: '是否满足温控要求'
  }
}, {
  tableName: 'massConcreteInsulations',
  timestamps: true
})

module.exports = MassConcreteInsulation