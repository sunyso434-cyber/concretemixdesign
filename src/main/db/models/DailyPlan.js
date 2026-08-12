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
    // v0.8.1：配合比改为分公司绑定（CapacityConfig.c30BaselineMixDesignId），此字段废弃
    // 保留列以兼容老库数据，新逻辑不再使用
    boundMixDesignId: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
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
