const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const BasicMixDesign = sequelize.define('BasicMixDesign', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  strengthGrade: { type: DataTypes.STRING, allowNull: false },
  concreteType: { type: DataTypes.STRING, allowNull: false, defaultValue: '普通' },
  slump: { type: DataTypes.FLOAT },
  materials: { type: DataTypes.JSON, allowNull: false },
  isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
  remarks: { type: DataTypes.TEXT },
  source: { type: DataTypes.STRING, defaultValue: '手工新增' },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'basicMixDesigns',
  timestamps: true
})

module.exports = BasicMixDesign