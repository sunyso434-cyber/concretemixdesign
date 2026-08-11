const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const ProjectDistance = sequelize.define('ProjectDistance', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    projectName: { type: DataTypes.STRING, allowNull: false },
    branchId: { type: DataTypes.INTEGER, allowNull: false },
    distanceKm: { type: DataTypes.FLOAT, allowNull: false },
    baseTransportMin: { type: DataTypes.INTEGER, allowNull: false },
    peakStart1: { type: DataTypes.STRING, allowNull: true },
    peakEnd1: { type: DataTypes.STRING, allowNull: true },
    peakStart2: { type: DataTypes.STRING, allowNull: true },
    peakEnd2: { type: DataTypes.STRING, allowNull: true },
    peakFactor: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1.0 },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: 'project_distances',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['projectName', 'branchId'] }
    ]
  })
  return ProjectDistance
}
