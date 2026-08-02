'use strict'

// 安全/访问日志 SecurityLog：与业务审计 AuditLog 分离
// 路径：test 在 src/main/remote/__tests__/，../SecurityLog 到 src/main/remote/SecurityLog.js
//      ../../db/database 到 src/main/db/database.js
const SecurityLog = require('../SecurityLog')
const { SecurityLog: SecurityLogModel, sequelize } = require('../../db/database')

describe('SecurityLog（安全/访问日志）', () => {
  beforeAll(async () => {
    // jest.setup.js 已把 USER_DATA_PATH 指向临时目录，此处直接建表
    await SecurityLogModel.sync()
  })

  beforeEach(async () => {
    // 每个用例独立清空，避免相互污染
    await SecurityLogModel.destroy({ truncate: true })
  })

  afterAll(async () => {
    await sequelize.close()
  })

  test('record 写入一行，字段完整', async () => {
    const created = await SecurityLog.record({
      event: 'auth.login',
      deviceId: 'device-001',
      detail: '移动端配对成功',
      origin: 'remote',
      ok: true
    })

    expect(created.id).toBeDefined()
    // timestamp 由模型默认值自动填充
    expect(created.timestamp).toBeInstanceOf(Date)

    const row = await SecurityLogModel.findByPk(created.id)
    expect(row.event).toBe('auth.login')
    expect(row.deviceId).toBe('device-001')
    expect(row.detail).toBe('移动端配对成功')
    expect(row.origin).toBe('remote')
    expect(row.ok).toBe(true)
  })

  test('origin 区分 desktop 与 remote，ok 记录成败', async () => {
    await SecurityLog.record({ event: 'app.launch', deviceId: 'local', origin: 'desktop', ok: true })
    await SecurityLog.record({ event: 'remote.pair', deviceId: 'dev-9', origin: 'remote', ok: false })

    const rows = await SecurityLogModel.findAll({ order: [['id', 'ASC']] })
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.origin)).toEqual(['desktop', 'remote'])
    expect(rows.map(r => r.ok)).toEqual([true, false])
  })

  test('默认值：ok=true、detail=null、origin=remote', async () => {
    const row = await SecurityLog.record({ event: 'remote.connect', deviceId: 'dev-7' })

    expect(row.ok).toBe(true)
    expect(row.detail).toBeNull()
    expect(row.origin).toBe('remote')
  })

  test('表名为 security_logs，带 timestamp 索引', async () => {
    expect(SecurityLogModel.tableName).toBe('security_logs')

    const tables = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'security_logs'",
      { type: sequelize.QueryTypes.SELECT }
    )
    expect(tables).toHaveLength(1)

    const indexes = await sequelize.getQueryInterface().showIndex('security_logs')
    expect(indexes.some(idx => idx.fields.some(f => f.attribute === 'timestamp'))).toBe(true)
  })
})
