const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const SalesQuoteHistory = sequelize.define('SalesQuoteHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  strengthGrade: { type: DataTypes.STRING },
  concreteType: { type: DataTypes.STRING },
  slump: { type: DataTypes.FLOAT },
  basicMixId: { type: DataTypes.INTEGER, allowNull: true },
  basicMixName: { type: DataTypes.STRING },
  pricingParams: { type: DataTypes.JSON },
  materialPriceOverrides: { type: DataTypes.JSON },
  materialDetails: { type: DataTypes.JSON },
  selectedPumpingItems: { type: DataTypes.JSON },
  resultSnapshot: { type: DataTypes.JSON },
  remarks: { type: DataTypes.TEXT }
}, {
  tableName: 'salesQuoteHistories',
  timestamps: true
})

module.exports = SalesQuoteHistory
