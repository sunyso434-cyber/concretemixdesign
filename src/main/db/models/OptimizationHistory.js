const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const OptimizationHistory = sequelize.define('OptimizationHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  projectName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  constraints: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '优化约束条件（性能目标 + 自定义限值）'
  },
  bestSolution: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '最优配合比方案'
  },
  alternatives: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '备选方案列表'
  }
}, {
  tableName: 'optimization_history',
  timestamps: true
})

module.exports = OptimizationHistory
