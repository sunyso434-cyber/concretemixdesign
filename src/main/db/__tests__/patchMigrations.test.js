const { sequelize } = require('../database')
const { runPatchMigrations, PATCH_MIGRATIONS } = require('../patchMigrations')

describe('patchMigrations', () => {
  beforeAll(async () => {
    // 建全部业务表（模拟新库：sync 后模型列齐全，补丁迁移应全部幂等通过）
    await sequelize.sync()
    await sequelize.query('DROP TABLE IF EXISTS schema_migrations')
  })

  afterAll(async () => {
    await sequelize.close()
  })

  test('注册表非空且名字唯一（名字是幂等键）', () => {
    expect(PATCH_MIGRATIONS.length).toBeGreaterThanOrEqual(8)
    const names = PATCH_MIGRATIONS.map(m => m.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('首次运行执行全部迁移并写入 schema_migrations 记录', async () => {
    await sequelize.query('DROP TABLE IF EXISTS schema_migrations')
    const result = await runPatchMigrations(sequelize)
    expect(result.executed).toBe(PATCH_MIGRATIONS.length)
    const [rows] = await sequelize.query(
      "SELECT name FROM schema_migrations WHERE name LIKE '2026-08-21-p%'"
    )
    expect(rows.length).toBe(PATCH_MIGRATIONS.length)
  })

  test('第二次运行全部跳过（记录已存在）', async () => {
    const result = await runPatchMigrations(sequelize)
    expect(result.executed).toBe(0)
    expect(result.skipped).toBe(PATCH_MIGRATIONS.length)
  })

  test('老库列已存在时 up 幂等通过（不抛错）', async () => {
    // 删掉一条记录模拟老库：列已在但记录缺失 → 重跑该迁移应幂等通过
    const target = PATCH_MIGRATIONS[0]
    await sequelize.query('DELETE FROM schema_migrations WHERE name = ?', {
      replacements: [target.name]
    })
    const result = await runPatchMigrations(sequelize)
    expect(result.executed).toBe(1)
    // 跑完记录补上
    const [rows] = await sequelize.query(
      'SELECT name FROM schema_migrations WHERE name = ?',
      { replacements: [target.name] }
    )
    expect(rows.length).toBe(1)
  })

  test('迁移抛错时不写入记录（下次启动重试）', async () => {
    const target = PATCH_MIGRATIONS[PATCH_MIGRATIONS.length - 1]
    await sequelize.query('DELETE FROM schema_migrations WHERE name = ?', {
      replacements: [target.name]
    })
    // 临时替换 up 为抛错版本
    const original = target.up
    target.up = async () => { throw new Error('boom') }
    await expect(runPatchMigrations(sequelize)).rejects.toThrow('boom')
    target.up = original
    // 记录未写入
    const [rows] = await sequelize.query(
      'SELECT name FROM schema_migrations WHERE name = ?',
      { replacements: [target.name] }
    )
    expect(rows.length).toBe(0)
    // 恢复后重跑成功
    const result = await runPatchMigrations(sequelize)
    expect(result.executed).toBe(1)
  })
})
