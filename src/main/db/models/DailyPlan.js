const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const DailyPlan = sequelize.define('DailyPlan', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    planDate: { type: DataTypes.STRING, allowNull: false },
    projectName: { type: DataTypes.STRING, allowNull: false },
    constructionUnit: { type: DataTypes.STRING, allowNull: true },
    pourLocation: { type: DataTypes.STRING, allowNull: false },
    receiveMethod: { type: DataTypes.STRING, allowNull: true },
    strengthGrade: { type: DataTypes.STRING, allowNull: false },
    volume: { type: DataTypes.FLOAT, allowNull: false },
    branchId: { type: DataTypes.INTEGER, allowNull: false },
    plannedSendTime: { type: DataTypes.STRING, allowNull: false },
    equipmentInfo: { type: DataTypes.JSON, allowNull: true },
    expectedDuration: { type: DataTypes.FLOAT, allowNull: false },
    boundMixDesignId: { type: DataTypes.INTEGER, allowNull: false },
    remarks: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: 'daily_plans',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['planDate', 'projectName', 'pourLocation', 'strengthGrade', 'branchId'] }
    ]
  })
  return DailyPlan
}
