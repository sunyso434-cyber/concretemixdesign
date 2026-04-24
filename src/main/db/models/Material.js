const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const Material = sequelize.define('Material', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  specification: {
    type: DataTypes.STRING
  },
  manufacturer: {
    type: DataTypes.STRING
  },
  price: {
    type: DataTypes.FLOAT
  },
  density: {
    type: DataTypes.FLOAT
  },
  fineness: {
    type: DataTypes.FLOAT
  },
  waterContent: {
    type: DataTypes.FLOAT
  },
  // 水泥专用字段
  specificSurfaceArea: {
    type: DataTypes.FLOAT
  },
  standardConsistency: {
    type: DataTypes.FLOAT
  },
  stability: {
    type: DataTypes.STRING
  },
  initialSettingTime: {
    type: DataTypes.INTEGER
  },
  finalSettingTime: {
    type: DataTypes.INTEGER
  },
  flexuralStrength3d: {
    type: DataTypes.FLOAT
  },
  flexuralStrength28d: {
    type: DataTypes.FLOAT
  },
  compressiveStrength3d: {
    type: DataTypes.FLOAT
  },
  compressiveStrength28d: {
    type: DataTypes.FLOAT
  },
  // 水泥水化热字段 (单位: kJ/kg)
  cementHeat3d: {
    type: DataTypes.FLOAT,
    defaultValue: 260,
    comment: '水泥3天水化热 kJ/kg'
  },
  cementHeat7d: {
    type: DataTypes.FLOAT,
    defaultValue: 300,
    comment: '水泥7天水化热 kJ/kg'
  },
  // 粉煤灰专用字段
  waterDemandRatio: {
    type: DataTypes.FLOAT
  },
  lossOnIgnition: {
    type: DataTypes.FLOAT
  },
  activityIndex7d: {
    type: DataTypes.FLOAT
  },
  activityIndex28d: {
    type: DataTypes.FLOAT
  },
  // 矿渣粉专用字段
  fluidityRatio: {
    type: DataTypes.FLOAT
  },
  // 细骨料专用字段
  mudContent: {
    type: DataTypes.FLOAT
  },
  clayLumpContent: {
    type: DataTypes.FLOAT
  },
  mbValue: {
    type: DataTypes.FLOAT
  },
  finenessModulus: {
    type: DataTypes.FLOAT
  },
  // 粗骨料专用字段
  needleFlakeContent: {
    type: DataTypes.FLOAT
  },
  crushingValue: {
    type: DataTypes.FLOAT
  },
  grading: {
    type: DataTypes.STRING
  },
  // 外加剂专用字段
  solidContent: {
    type: DataTypes.FLOAT
  },
  waterReducingRate: {
    type: DataTypes.FLOAT
  },
  airContent: {
    type: DataTypes.FLOAT
  },
  recommendedDosage: {
    type: DataTypes.FLOAT
  },
  // 减水剂专用：减水率与掺量关系值（每增加0.1%掺量，减水率增加的百分比）
  waterReducingRatePer01Dosage: {
    type: DataTypes.FLOAT,
    defaultValue: 2.0
  },
  // 掺合料专用：影响系数五个档位（10%、20%、30%、40%、50%）
  influenceFactor_10: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0
  },
  influenceFactor_20: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0
  },
  influenceFactor_30: {
    type: DataTypes.FLOAT,
    defaultValue: 1.05
  },
  influenceFactor_40: {
    type: DataTypes.FLOAT,
    defaultValue: 1.1
  },
  influenceFactor_50: {
    type: DataTypes.FLOAT,
    defaultValue: 1.15
  },
  // 水专用字段
  phValue: {
    type: DataTypes.FLOAT
  },
  insolubleMatter: {
    type: DataTypes.FLOAT
  },
  solubleMatter: {
    type: DataTypes.FLOAT
  },
  // 筛孔字段 - 细骨料
  sieve_4_75: {
    type: DataTypes.FLOAT
  },
  sieve_2_36: {
    type: DataTypes.FLOAT
  },
  sieve_1_18: {
    type: DataTypes.FLOAT
  },
  sieve_0_60: {
    type: DataTypes.FLOAT
  },
  sieve_0_30: {
    type: DataTypes.FLOAT
  },
  sieve_0_15: {
    type: DataTypes.FLOAT
  },
  // 筛孔字段 - 粗骨料
  sieve_37_5: {
    type: DataTypes.FLOAT
  },
  sieve_31_5: {
    type: DataTypes.FLOAT
  },
  sieve_26_5: {
    type: DataTypes.FLOAT
  },
  sieve_19_0: {
    type: DataTypes.FLOAT
  },
  sieve_16_0: {
    type: DataTypes.FLOAT
  },
  sieve_9_50: {
    type: DataTypes.FLOAT
  },
  // 其他字段
  chemicalComposition: {
    type: DataTypes.TEXT
  },
  testData: {
    type: DataTypes.JSON
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: '正常'
  },
  notes: {
    type: DataTypes.TEXT
  },
  price: {
    type: DataTypes.FLOAT, // 原材料单价（元/吨）
    allowNull: true
  },
  isSystem: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否系统预设材料，true表示系统预设，false表示用户添加'
  }
}, {
  tableName: 'materials',
  timestamps: true
})

module.exports = Material