'use strict'

const { DataTypes } = require('sequelize')
const { sequelize } = require('../database')

/**
 * Agent 断点续跑检查点
 *
 * 存储：
 * - todo_snapshot：todo 数组快照（JSON），崩溃后恢复 todo 状态
 * - last_step：主循环当前步数，崩溃后恢复 step 计数器（允许滞后 1 步）
 *
 * 设计要点：
 * - 一个 session 一行（session_id UNIQUE）
 * - todo 变更时 upsert todo_snapshot（todo-manage.js 调用）
 * - 主循环每步末尾 upsert last_step（UnifiedStrategy 异步写，不 await）
 * - 续跑时读出 todo_snapshot 还原进内存 Map，读 last_step 恢复 step 计数器
 * - 不存事件流（与 ChatHistory 重复建设），只存"断点快照"
 */
const AgentCheckpoint = sequelize.define('AgentCheckpoint', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sessionId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    field: 'session_id'
  },
  lastStep: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'last_step'
  },
  todoSnapshot: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'todo_snapshot'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'agent_checkpoint',
  timestamps: false  // updatedAt 手动管理（upsert 时设值），不用 Sequelize 自动 updatedAt
})

module.exports = AgentCheckpoint
