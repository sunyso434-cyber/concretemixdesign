const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const PumpingFeeItem = sequelize.define('PumpingFeeItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  unitPrice: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'pumpingFeeItems',
  timestamps: true
})

const DEFAULT_PUMPING_FEE_ITEMS = [
  { name: '车泵 40m以下', unitPrice: 20, sortOrder: 1 },
  { name: '车泵 40-50m', unitPrice: 25, sortOrder: 2 },
  { name: '车泵 50-60m', unitPrice: 30, sortOrder: 3 },
  { name: '车泵 60m以上', unitPrice: 35, sortOrder: 4 },
  { name: '电泵', unitPrice: 15, sortOrder: 5 },
  { name: '柴油泵', unitPrice: 18, sortOrder: 6 }
]

module.exports = PumpingFeeItem
module.exports.DEFAULT_PUMPING_FEE_ITEMS = DEFAULT_PUMPING_FEE_ITEMS
