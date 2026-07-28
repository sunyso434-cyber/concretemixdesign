const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MaterialBatch = sequelize.define('MaterialBatch', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  materialId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // 审查 P7：materialId 索引在 database.js syncModels 中手动创建
  },
  materialType: {
    type: DataTypes.STRING,
    allowNull: false  // 审查 C1：应用层软约束校验
  },
  batchNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      is: /^[A-Za-z0-9\-]+$/  // 审查 L1：格式校验
    }
  },
  productionDate: { type: DataTypes.DATE },
  testDate: { type: DataTypes.DATE },
  testReportNo: { type: DataTypes.STRING },
  expiryDate: { type: DataTypes.DATE },
  receiptDate: { type: DataTypes.DATE },  // 审查 N5：骨料库存超期判断
  status: { type: DataTypes.STRING, defaultValue: '在用' },
  price: { type: DataTypes.FLOAT },  // 审查 H4：通用字段（非水专用）
  notes: { type: DataTypes.TEXT },

  // ===== 通用检测值 =====
  density: { type: DataTypes.FLOAT },
  fineness: { type: DataTypes.FLOAT },
  waterContent: { type: DataTypes.FLOAT },

  // ===== 水泥专用（12 字段）=====
  specificSurfaceArea: { type: DataTypes.FLOAT },
  standardConsistency: { type: DataTypes.FLOAT },
  stability: { type: DataTypes.STRING },
  initialSettingTime: { type: DataTypes.INTEGER },
  finalSettingTime: { type: DataTypes.INTEGER },
  flexuralStrength3d: { type: DataTypes.FLOAT },
  flexuralStrength28d: { type: DataTypes.FLOAT },
  compressiveStrength3d: { type: DataTypes.FLOAT },
  compressiveStrength28d: { type: DataTypes.FLOAT },
  cementHeat3d: { type: DataTypes.FLOAT, defaultValue: 260 },
  cementHeat7d: { type: DataTypes.FLOAT, defaultValue: 300 },

  // ===== 掺合料专用（10 字段）=====
  waterDemandRatio: { type: DataTypes.FLOAT },
  lossOnIgnition: { type: DataTypes.FLOAT },
  activityIndex7d: { type: DataTypes.FLOAT },
  activityIndex28d: { type: DataTypes.FLOAT },
  fluidityRatio: { type: DataTypes.FLOAT },
  influenceFactor_10: { type: DataTypes.FLOAT, defaultValue: 1.0 },
  influenceFactor_20: { type: DataTypes.FLOAT, defaultValue: 1.0 },
  influenceFactor_30: { type: DataTypes.FLOAT, defaultValue: 1.05 },
  influenceFactor_40: { type: DataTypes.FLOAT, defaultValue: 1.1 },
  influenceFactor_50: { type: DataTypes.FLOAT, defaultValue: 1.15 },

  // ===== 细骨料专用（10 字段）=====
  mudContent: { type: DataTypes.FLOAT },
  clayLumpContent: { type: DataTypes.FLOAT },
  mbValue: { type: DataTypes.FLOAT },
  finenessModulus: { type: DataTypes.FLOAT },
  sieve_4_75: { type: DataTypes.FLOAT },
  sieve_2_36: { type: DataTypes.FLOAT },
  sieve_1_18: { type: DataTypes.FLOAT },
  sieve_0_60: { type: DataTypes.FLOAT },
  sieve_0_30: { type: DataTypes.FLOAT },
  sieve_0_15: { type: DataTypes.FLOAT },

  // ===== 粗骨料专用（8 字段）=====
  needleFlakeContent: { type: DataTypes.FLOAT },
  crushingValue: { type: DataTypes.FLOAT },
  grading: { type: DataTypes.STRING },
  sieve_37_5: { type: DataTypes.FLOAT },
  sieve_31_5: { type: DataTypes.FLOAT },
  sieve_26_5: { type: DataTypes.FLOAT },
  sieve_19_0: { type: DataTypes.FLOAT },
  sieve_16_0: { type: DataTypes.FLOAT },
  sieve_9_50: { type: DataTypes.FLOAT },

  // ===== 外加剂专用（5 字段）=====
  solidContent: { type: DataTypes.FLOAT },
  waterReducingRate: { type: DataTypes.FLOAT },
  airContent: { type: DataTypes.FLOAT },
  recommendedDosage: { type: DataTypes.FLOAT },
  waterReducingRatePer01Dosage: { type: DataTypes.FLOAT, defaultValue: 2.0 },

  // ===== 水专用（3 字段）=====
  phValue: { type: DataTypes.FLOAT },
  insolubleMatter: { type: DataTypes.FLOAT },
  solubleMatter: { type: DataTypes.FLOAT }
}, {
  tableName: 'material_batches',
  timestamps: true
})

module.exports = MaterialBatch
