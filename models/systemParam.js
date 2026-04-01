// 系统参数模型
module.exports = (sequelize, DataTypes) => {
  const SystemParam = sequelize.define('SystemParam', {
    // 基本信息
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    paramName: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: '参数名称'
    },
    paramValue: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '参数值'
    },
    paramType: {
      type: DataTypes.STRING,
      comment: '参数类型'
    },
    description: {
      type: DataTypes.TEXT,
      comment: '参数描述'
    },
    // 其他信息
    status: {
      type: DataTypes.STRING,
      defaultValue: '正常',
      comment: '状态（正常、禁用）'
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
    tableName: 'systemParams',
    timestamps: true
  });

  return SystemParam;
};