const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

const MassConcreteHeatDissipation = sequelize.define('MassConcreteHeatDissipation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  windSpeedRef: {
    type: DataTypes.STRING,  // 如 "0", "1~2", "3~5", "6~10"
    allowNull: true
  },
  beta: {
    type: DataTypes.FLOAT,  // W/(m²·K)
    allowNull: false
  },
  isDefault: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  remarks: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'massConcreteHeatDissipation',
  timestamps: true
})

module.exports = MassConcreteHeatDissipation