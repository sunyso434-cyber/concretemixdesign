const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const CapacityConfig = sequelize.define('CapacityConfig', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    branchName: { type: DataTypes.STRING, allowNull: false },
    lineCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    lineSpec: { type: DataTypes.JSON, allowNull: true },
    c30Efficiency: { type: DataTypes.FLOAT, allowNull: false },
    mixerTowerNos: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    selfOilTruckCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    selfOilTruckPrice: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    selfOilTruckCapacity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 8 },
    selfElecTruckCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    selfElecTruckPrice: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    selfElecTruckCapacity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 8 },
    rentalTruckCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rentalTruckPrice: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    rentalTruckCapacity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 8 },
    loadTimeMin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
    unloadTimeMin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
    mixCoefficients: { type: DataTypes.JSON, allowNull: false, defaultValue: { C30: 1.0 } },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: 'capacity_configs',
    timestamps: true
  })
  return CapacityConfig
}
