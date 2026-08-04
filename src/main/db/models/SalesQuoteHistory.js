const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const SalesQuoteHistory = sequelize.define('SalesQuoteHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  strengthGrade: { type: DataTypes.STRING },
  concreteType: { type: DataTypes.STRING },
  slump: { type: DataTypes.FLOAT },
  basicMixId: { type: DataTypes.INTEGER, allowNull: true },
  basicMixName: { type: DataTypes.STRING },
  mixDesignId: { type: DataTypes.INTEGER, allowNull: true },
  pricingParams: { type: DataTypes.JSON },
  materialPriceOverrides: { type: DataTypes.JSON },
  materialDetails: { type: DataTypes.JSON },
  selectedPumpingItems: { type: DataTypes.JSON },
  resultSnapshot: { type: DataTypes.JSON },
  remarks: { type: DataTypes.TEXT },
  // v10.10 新增：双模式报价
  quoteMode: { type: DataTypes.STRING, allowNull: true },
  polishStrategy: { type: DataTypes.STRING, allowNull: true },
  polishedUnitPrices: { type: DataTypes.JSON, allowNull: true },
  equipmentPurchaseCost: { type: DataTypes.FLOAT, allowNull: true },
  equipmentAmortizeVolume: { type: DataTypes.FLOAT, allowNull: true },
  equipmentUnitAmortization: { type: DataTypes.FLOAT, allowNull: true },
  // v0.6.0 Task 1.12：幂等键（tool_call_id），断点续跑重跑同一工具调用时查重用
  requestId: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: 'salesQuoteHistories',
  timestamps: true
})

module.exports = SalesQuoteHistory
