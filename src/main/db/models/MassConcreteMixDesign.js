const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteMixDesign = sequelize.define('MassConcreteMixDesign', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schemeId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  strengthGrade: {
    type: DataTypes.STRING,
    comment: '强度等级 如C30'
  },
  cementContent: {
    type: DataTypes.FLOAT,
    comment: '水泥用量 kg/m³'
  },
  flyAshContent: {
    type: DataTypes.FLOAT,
    comment: '粉煤灰用量 kg/m³'
  },
  slagContent: {
    type: DataTypes.FLOAT,
    comment: '矿渣粉用量 kg/m³'
  },
  totalBinder: {
    type: DataTypes.FLOAT,
    comment: '总胶凝材料 kg/m³'
  },
  cementHeat3d: {
    type: DataTypes.FLOAT,
    comment: '水泥3d水化热 kJ/kg'
  },
  cementHeat7d: {
    type: DataTypes.FLOAT,
    comment: '水泥7d水化热 kJ/kg'
  },
  totalHeat: {
    type: DataTypes.FLOAT,
    comment: '总发热量 kJ/m³'
  },
  waterBinderRatio: {
    type: DataTypes.FLOAT,
    comment: '水胶比'
  },
  sandRatio: {
    type: DataTypes.FLOAT,
    comment: '砂率 %'
  },
  waterContent: {
    type: DataTypes.FLOAT,
    comment: '用水量 kg/m³'
  },
  sandContent: {
    type: DataTypes.FLOAT,
    comment: '砂用量 kg/m³'
  },
  stoneContent: {
    type: DataTypes.FLOAT,
    comment: '石用量 kg/m³'
  },
  admixtureContent: {
    type: DataTypes.FLOAT,
    comment: '外加剂用量 kg/m³'
  },
  remarks: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'massConcreteMixDesigns',
  timestamps: true
})

module.exports = MassConcreteMixDesign