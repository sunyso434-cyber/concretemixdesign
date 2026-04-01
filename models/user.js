// 用户模型
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    // 基本信息
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: '用户名'
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '密码'
    },
    name: {
      type: DataTypes.STRING,
      comment: '姓名'
    },
    email: {
      type: DataTypes.STRING,
      comment: '邮箱'
    },
    phone: {
      type: DataTypes.STRING,
      comment: '电话'
    },
    // 角色和权限
    role: {
      type: DataTypes.STRING,
      defaultValue: 'user',
      comment: '角色（admin、user）'
    },
    permissions: {
      type: DataTypes.JSON,
      comment: '权限列表'
    },
    // 其他信息
    status: {
      type: DataTypes.STRING,
      defaultValue: '正常',
      comment: '状态（正常、禁用）'
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      comment: '最后登录时间'
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
    tableName: 'users',
    timestamps: true
  });

  return User;
};