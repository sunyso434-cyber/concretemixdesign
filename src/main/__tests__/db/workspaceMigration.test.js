'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { Sequelize, DataTypes } = require('sequelize')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mig-'))
const dbPath = path.join(tmpDir, 'test.db')

const sequelize = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false })

// 构建一个最小 queryInterface（sequelize-cli 风格）
const qi = sequelize.getQueryInterface()

// 准备 chat_history 和 ChatSessions 表（模拟迁移前的状态）
beforeAll(async () => {
  await qi.createTable('chat_history', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    toolCallId: { type: DataTypes.STRING, allowNull: true },
    toolCalls: { type: DataTypes.JSON },
    metadata: { type: DataTypes.JSON },
    stopReason: { type: DataTypes.STRING(32), allowNull: true },
    createdAt: { type: DataTypes.DATE },
    updatedAt: { type: DataTypes.DATE }
  })
  await qi.createTable('ChatSessions', {
    sessionId: { type: DataTypes.STRING, primaryKey: true },
    sessionName: { type: DataTypes.STRING },
    createdAt: { type: DataTypes.DATE },
    lastActivity: { type: DataTypes.DATE }
  })

  // 插入一些测试数据（验证清空逻辑）
  await qi.bulkInsert('chat_history', [
    { sessionId: 'sess-1', role: 'user', content: 'hello', createdAt: new Date(), updatedAt: new Date() },
    { sessionId: 'sess-2', role: 'assistant', content: 'hi', createdAt: new Date(), updatedAt: new Date() }
  ])
  await qi.bulkInsert('ChatSessions', [
    { sessionId: 'sess-1', sessionName: 'test', createdAt: new Date(), lastActivity: new Date() }
  ])
})

afterAll(async () => {
  await sequelize.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('迁移脚本 2026-06-17-add-workspace-path', () => {
  const migration = require('../../../../migrations/2026-06-17-add-workspace-path')

  test('up: 应添加 workspacePath 列和索引，并清空历史数据', async () => {
    await migration.up(qi, Sequelize)

    // 验证 chat_history 列存在
    const columns = await qi.describeTable('chat_history')
    expect(columns.workspacePath).toBeDefined()
    // SQLite 下 Sequelize 将 STRING 映射为 VARCHAR
    expect(columns.workspacePath.type).toMatch(/STRING|VARCHAR/)

    // 验证 ChatSessions 列存在
    const sessColumns = await qi.describeTable('ChatSessions')
    expect(sessColumns.workspacePath).toBeDefined()
    expect(sessColumns.workspacePath.type).toMatch(/STRING|VARCHAR/)

    // 验证数据已清空
    const [chatRows] = await sequelize.query('SELECT COUNT(*) as cnt FROM chat_history')
    expect(chatRows[0].cnt).toBe(0)

    const [sessRows] = await sequelize.query('SELECT COUNT(*) as cnt FROM ChatSessions')
    expect(sessRows[0].cnt).toBe(0)

    // 验证索引存在（SQLite 通过 sqlite_master 查）
    const [idxRows] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chat_history_workspace'"
    )
    expect(idxRows.length).toBe(1)

    const [idxSessRows] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_workspace'"
    )
    expect(idxSessRows.length).toBe(1)
  })

  test('down: 应移除 workspacePath 列和索引', async () => {
    await migration.down(qi, Sequelize)

    // 验证列已删除
    const columns = await qi.describeTable('chat_history')
    expect(columns.workspacePath).toBeUndefined()

    const sessColumns = await qi.describeTable('ChatSessions')
    expect(sessColumns.workspacePath).toBeUndefined()

    // 验证索引已删除
    const [idxRows] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chat_history_workspace'"
    )
    expect(idxRows.length).toBe(0)

    const [idxSessRows] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_workspace'"
    )
    expect(idxSessRows.length).toBe(0)
  })
})

describe('模型字段验证', () => {
  test('ChatHistory 模型文件应包含 workspacePath 字段定义', () => {
    // 通过文件内容验证，避免 require 时触发 database.js 的循环依赖
    const content = fs.readFileSync(
      path.join(__dirname, '..', '..', 'db', 'models', 'ChatHistory.js'), 'utf8'
    )
    expect(content).toContain('workspacePath')
    expect(content).toContain('DataTypes.STRING(1000)')
  })

  test('ChatSession 模型文件应包含 workspacePath 字段定义', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', '..', 'db', 'models', 'ChatSession.js'), 'utf8'
    )
    expect(content).toContain('workspacePath')
    expect(content).toContain('DataTypes.STRING(1000)')
  })
})
