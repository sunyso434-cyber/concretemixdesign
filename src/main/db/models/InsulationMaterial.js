const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const InsulationMaterial = sequelize.define('InsulationMaterial', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  thermalConductivity: {
    type: DataTypes.FLOAT,
    comment: '导热系数 W/(m·K)'
  },
  heatStorageCoefficient: {
    type: DataTypes.FLOAT,
    comment: '蓄热系数 W/(m²·K)'
  },
  thickness: {
    type: DataTypes.FLOAT,
    comment: '常用厚度 mm'
  },
  unitPrice: {
    type: DataTypes.FLOAT,
    comment: '单价 元/m²'
  },
  remarks: {
    type: DataTypes.TEXT
  },
  isDefault: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'insulationMaterials',
  timestamps: true
})

module.exports = InsulationMaterial