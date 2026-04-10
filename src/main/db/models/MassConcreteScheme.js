const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteScheme = sequelize.define('MassConcreteScheme', {
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
  strengthGrade: {
    type: DataTypes.STRING,
    comment: '强度等级 如C30'
  },
  projectName: {
    type: DataTypes.STRING,
    comment: '项目名称'
  },
  builderName: {
    type: DataTypes.STRING,
    comment: '施工单位'
  },
  castingMethod: {
    type: DataTypes.STRING,
    comment: '浇筑方法'
  },
  ambientTemp: {
    type: DataTypes.FLOAT,
    comment: '环境温度 ℃'
  },
  thickness: {
    type: DataTypes.FLOAT,
    comment: '厚度 m'
  },
  length: {
    type: DataTypes.FLOAT,
    comment: '长度 m'
  },
  width: {
    type: DataTypes.FLOAT,
    comment: '宽度 m'
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'draft',
    validate: {
      isIn: [['draft', 'calculated', 'saved']]
    },
    comment: '状态：draft、calculated、saved'
  },
  remarks: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'massConcreteSchemes',
  timestamps: true
})

module.exports = MassConcreteScheme