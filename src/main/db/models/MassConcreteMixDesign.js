const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteMixDesign = sequelize.define('MassConcreteMixDesign', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  strength_grade: {
    type: DataTypes.STRING,
    comment: '强度等级 如C30'
  },
  cement_content: {
    type: DataTypes.FLOAT,
    comment: '水泥用量 kg/m³'
  },
  fly_ash_content: {
    type: DataTypes.FLOAT,
    comment: '粉煤灰用量 kg/m³'
  },
  slag_content: {
    type: DataTypes.FLOAT,
    comment: '矿渣粉用量 kg/m³'
  },
  total_binder: {
    type: DataTypes.FLOAT,
    comment: '总胶凝材料 kg/m³'
  },
  cement_heat_3d: {
    type: DataTypes.FLOAT,
    comment: '水泥3d水化热 kJ/kg'
  },
  cement_heat_7d: {
    type: DataTypes.FLOAT,
    comment: '水泥7d水化热 kJ/kg'
  },
  total_heat: {
    type: DataTypes.FLOAT,
    comment: '总发热量 kJ/m³'
  },
  water_binder_ratio: {
    type: DataTypes.FLOAT,
    comment: '水胶比'
  },
  sand_ratio: {
    type: DataTypes.FLOAT,
    comment: '砂率 %'
  },
  water_content: {
    type: DataTypes.FLOAT,
    comment: '用水量 kg/m³'
  },
  sand_content: {
    type: DataTypes.FLOAT,
    comment: '砂用量 kg/m³'
  },
  stone_content: {
    type: DataTypes.FLOAT,
    comment: '石用量 kg/m³'
  },
  admixture_content: {
    type: DataTypes.FLOAT,
    comment: '外加剂用量 kg/m³'
  },
  remarks: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'mass_concrete_mix_designs',
  timestamps: true
})

module.exports = MassConcreteMixDesign