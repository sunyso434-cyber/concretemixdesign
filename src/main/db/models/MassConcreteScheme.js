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
  strength_grade: {
    type: DataTypes.STRING,
    comment: '强度等级 如C30'
  },
  project_name: {
    type: DataTypes.STRING,
    comment: '项目名称'
  },
  builder_name: {
    type: DataTypes.STRING,
    comment: '施工单位'
  },
  casting_method: {
    type: DataTypes.STRING,
    comment: '浇筑方法'
  },
  ambient_temp: {
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
    defaultValue: '草稿',
    comment: '状态：草稿、已计算、已确认'
  },
  remarks: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'mass_concrete_schemes',
  timestamps: true
})

module.exports = MassConcreteScheme