const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const TrialTestRecord = sequelize.define('TrialTestRecord', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  // 配合比信息
  water_binder_ratio: { type: DataTypes.FLOAT },
  cement_amount: { type: DataTypes.FLOAT },
  fly_ash_dosage: { type: DataTypes.FLOAT },
  slag_dosage: { type: DataTypes.FLOAT },
  lithium_slag_dosage: { type: DataTypes.FLOAT },
  composite_powder_dosage: { type: DataTypes.FLOAT },
  sand_ratio: { type: DataTypes.FLOAT },
  water_amount: { type: DataTypes.FLOAT },
  superplasticizer_dosage: { type: DataTypes.FLOAT, comment: '设计掺量（特征 X）' },

  // 各材料用量 (kg/m³) — 用于完整用量表展示
  fly_ash_amount: { type: DataTypes.FLOAT, comment: '粉煤灰用量' },
  slag_amount: { type: DataTypes.FLOAT, comment: '矿渣粉用量' },
  lithium_slag_amount: { type: DataTypes.FLOAT, comment: '锂渣用量' },
  composite_powder_amount: { type: DataTypes.FLOAT, comment: '复合粉用量' },
  sand_amount: { type: DataTypes.FLOAT, comment: '砂用量' },
  stone_amount: { type: DataTypes.FLOAT, comment: '石用量' },
  superplasticizer_amount: { type: DataTypes.FLOAT, comment: '减水剂用量' },
  slump: { type: DataTypes.FLOAT, comment: '设计坍落度（feature_slump）' },

  // 材料批次关联
  cementBatchId: { type: DataTypes.INTEGER },
  flyAshBatchId: { type: DataTypes.INTEGER },
  slagBatchId: { type: DataTypes.INTEGER },
  lithiumSlagBatchId: { type: DataTypes.INTEGER },
  compositePowderBatchId: { type: DataTypes.INTEGER },
  sandBatchId: { type: DataTypes.JSON, comment: '砂批次ID数组，始终存数组：[1] 或 [1,2]' },
  stoneBatchId: { type: DataTypes.JSON, comment: '石批次ID数组，始终存数组：[1] 或 [1,2]' },
  superplasticizerBatchId: { type: DataTypes.INTEGER },

  // 可选方案关联
  mixDesignId: { type: DataTypes.INTEGER, allowNull: true, comment: '关联方案ID' },

  // 实测值
  trialTestedStrength7d: { type: DataTypes.FLOAT, comment: '实测 7d 强度（预留）' },
  trialTestedStrength: { type: DataTypes.FLOAT, comment: '实测 28d 强度' },
  trialTestedSlump: { type: DataTypes.FLOAT },
  trialTestedDensity: { type: DataTypes.FLOAT },
  trialTestedDosage: { type: DataTypes.FLOAT, comment: '实测减水剂掺量' },

  // 元数据
  trialTestDate: { type: DataTypes.DATE },
  trialOperator: { type: DataTypes.STRING },
  trialNotes: { type: DataTypes.TEXT },
  trialStatus: {
    type: DataTypes.STRING,
    defaultValue: '已试配',
    validate: { isIn: [['已试配', '已复核', '驳回']] }
  },
  deviationAnalysis: { type: DataTypes.JSON },
  trainedModelVersion: { type: DataTypes.STRING }
}, {
  tableName: 'trial_test_records',
  timestamps: true
})

module.exports = TrialTestRecord
