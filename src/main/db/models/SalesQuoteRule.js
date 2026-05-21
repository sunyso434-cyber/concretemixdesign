const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const SalesQuoteRule = sequelize.define('SalesQuoteRule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  concreteType: { type: DataTypes.STRING, allowNull: false, unique: true },
  keywords: { type: DataTypes.JSON, allowNull: false },
  salesExplanation: { type: DataTypes.TEXT },
  costDrivers: { type: DataTypes.JSON },
  productionDifficulties: { type: DataTypes.JSON },
  suggestedSlump: { type: DataTypes.FLOAT, defaultValue: 180 },
  suggestedManufacturingFee: { type: DataTypes.FLOAT, defaultValue: 18 },
  suggestedTechnicalServiceFee: { type: DataTypes.FLOAT, defaultValue: 0 },
  technicalServiceFeeRange: { type: DataTypes.JSON },
  suggestedProfitRate: { type: DataTypes.FLOAT, defaultValue: 0.12 },
  suggestedTransportFee: { type: DataTypes.FLOAT, defaultValue: 0 },
  suggestedPumpingFee: { type: DataTypes.FLOAT, defaultValue: 0 },
  vatRate: { type: DataTypes.FLOAT, defaultValue: 0.13 },
  quoteRangeDelta: { type: DataTypes.FLOAT, defaultValue: 5 },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'salesQuoteRules',
  timestamps: true
})

module.exports = SalesQuoteRule