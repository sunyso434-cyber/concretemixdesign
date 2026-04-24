const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MixDesign = sequelize.define('MixDesign', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  projectName: {
    type: DataTypes.STRING
  },
  description: {
    type: DataTypes.TEXT
  },
  strength: {
    type: DataTypes.STRING,
    allowNull: false
  },
  slump: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  environment: {
    type: DataTypes.STRING,
    allowNull: true
  },
  waterRatio: {
    type: DataTypes.FLOAT
  },
  sandRatio: {
    type: DataTypes.FLOAT
  },
  density: {
    type: DataTypes.FLOAT
  },
  materials: {
    type: DataTypes.JSON
  },
  validationResult: {
    type: DataTypes.JSON
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: '未验证'
  },
  tempSettings: {
    type: DataTypes.JSON
  },
  materialCosts: {
    type: DataTypes.JSON
  },
  totalCost: {
    type: DataTypes.FLOAT
  },
  materialDetails: {
    type: DataTypes.JSON
  },
  fineAggregateBreakdown: {
    type: DataTypes.JSON
  },
  coarseAggregateBreakdown: {
    type: DataTypes.JSON
  }
}, {
  tableName: 'mixDesigns',
  timestamps: true
})

module.exports = MixDesign
