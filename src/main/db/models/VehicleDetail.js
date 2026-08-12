const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const VehicleDetail = sequelize.define('VehicleDetail', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    planId: { type: DataTypes.INTEGER, allowNull: true },
    mixerTowerNo: { type: DataTypes.STRING, allowNull: false },
    productionDate: { type: DataTypes.STRING, allowNull: false },
    productionTime: { type: DataTypes.STRING, allowNull: false },
    taskOrderNo: { type: DataTypes.STRING, allowNull: true },
    shipmentNo: { type: DataTypes.STRING, allowNull: false },
    constructionUnit: { type: DataTypes.STRING, allowNull: true },
    projectName: { type: DataTypes.STRING, allowNull: false },
    pourLocation: { type: DataTypes.STRING, allowNull: false },
    strengthGrade: { type: DataTypes.STRING, allowNull: false },
    operator: { type: DataTypes.STRING, allowNull: true },
    volume: { type: DataTypes.FLOAT, allowNull: false },
    plateNo: { type: DataTypes.STRING, allowNull: true },
    vehicleNo: { type: DataTypes.STRING, allowNull: true },
    driver: { type: DataTypes.STRING, allowNull: true },
    supplyMethod: { type: DataTypes.STRING, allowNull: true },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'manual' },
    unmatchedReason: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: 'vehicle_details',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['shipmentNo', 'productionDate'] },
      { fields: ['planId'] }
    ]
  })
  return VehicleDetail
}
