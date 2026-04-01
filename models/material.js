// 原材料模型
module.exports = (sequelize, DataTypes) => {
  const Material = sequelize.define('Material', {
    // 基本信息
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '原材料名称'
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '原材料类型（水泥、骨料、外加剂等）'
    },
    specification: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '规格型号'
    },
    manufacturer: {
      type: DataTypes.STRING,
      comment: '生产厂家'
    },
    supplier: {
      type: DataTypes.STRING,
      comment: '供应商'
    },
    batchNumber: {
      type: DataTypes.STRING,
      comment: '批次号'
    },
    productionDate: {
      type: DataTypes.DATE,
      comment: '生产日期'
    },
    // 物理性能
    density: {
      type: DataTypes.FLOAT,
      comment: '密度 (kg/m³)'
    },
    fineness: {
      type: DataTypes.FLOAT,
      comment: '细度'
    },
    waterContent: {
      type: DataTypes.FLOAT,
      comment: '含水率 (%)'
    },
    absorption: {
      type: DataTypes.FLOAT,
      comment: '吸水率 (%)'
    },
    // 化学性能
    chemicalComposition: {
      type: DataTypes.JSON,
      comment: '化学组成'
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
    tableName: 'materials',
    timestamps: true
  });

  return Material;
};