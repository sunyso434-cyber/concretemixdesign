// 配合比方案模型
module.exports = (sequelize, DataTypes) => {
  const MixDesign = sequelize.define('MixDesign', {
    // 基本信息
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '方案名称'
    },
    projectName: {
      type: DataTypes.STRING,
      comment: '项目名称'
    },
    description: {
      type: DataTypes.TEXT,
      comment: '方案描述'
    },
    // 设计参数
    strength: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '强度等级'
    },
    slump: {
      type: DataTypes.FLOAT,
      comment: '坍落度 (mm)'
    },
    environmentClass: {
      type: DataTypes.STRING,
      comment: '环境类别'
    },
    durabilityRequirement: {
      type: DataTypes.JSON,
      comment: '耐久性要求'
    },
    // 配合比计算结果
    waterCementRatio: {
      type: DataTypes.FLOAT,
      comment: '水灰比'
    },
    sandRatio: {
      type: DataTypes.FLOAT,
      comment: '砂率 (%)'
    },
    unitWeight: {
      type: DataTypes.FLOAT,
      comment: '容重 (kg/m³)'
    },
    // 原材料用量
    materialsUsage: {
      type: DataTypes.JSON,
      comment: '原材料用量'
    },
    // 验证结果
    validationResult: {
      type: DataTypes.JSON,
      comment: '验证结果'
    },
    // 其他信息
    status: {
      type: DataTypes.STRING,
      defaultValue: '正常',
      comment: '状态（正常、禁用）'
    },
    remark: {
      type: DataTypes.TEXT,
      comment: '备注'
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'mixDesigns',
    timestamps: true
  });

  return MixDesign;
};