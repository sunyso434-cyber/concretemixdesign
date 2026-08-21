jest.mock('../../db/services/SessionCleanupService', () => ({
  cleanupOldSessions: jest.fn().mockResolvedValue({ deleted: 0 })
}))

const { runMaintenance, LAST_RUN_KEY } = require('../MaintenanceSchedulerService')
const { AppSetting, sequelize } = require('../../db/database')
const { cleanupOldSessions } = require('../../db/services/SessionCleanupService')

describe('MaintenanceSchedulerService', () => {
  beforeEach(() => {
    cleanupOldSessions.mockClear()
  })

  beforeAll(async () => {
    await sequelize.sync()
  })

  afterAll(async () => {
    try {
      await AppSetting.destroy({ where: { key: LAST_RUN_KEY } })
    } finally {
      await sequelize.close()
    }
  })

  test('无记录时执行维护并写入时间戳', async () => {
    await AppSetting.destroy({ where: { key: LAST_RUN_KEY } })
    const result = await runMaintenance()
    expect(result.executed).toBe(true)
    const row = await AppSetting.findOne({ where: { key: LAST_RUN_KEY } })
    expect(row).not.toBeNull()
  })

  test('时间戳在 24 小时内时跳过', async () => {
    await AppSetting.upsert({ key: LAST_RUN_KEY, value: new Date().toISOString() })
    const result = await runMaintenance()
    expect(result.executed).toBe(false)
    expect(result.reason).toBe('interval-not-reached')
    expect(cleanupOldSessions).not.toHaveBeenCalled()
  })

  test('时间戳超过 24 小时时执行并刷新时间戳', async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await AppSetting.upsert({ key: LAST_RUN_KEY, value: stale })
    const result = await runMaintenance()
    expect(result.executed).toBe(true)
    const row = await AppSetting.findOne({ where: { key: LAST_RUN_KEY } })
    expect(new Date(row.value).getTime()).toBeGreaterThan(new Date(stale).getTime())
  })

  test('清理任务抛错时不更新时间戳（下次重试）', async () => {
    cleanupOldSessions.mockRejectedValueOnce(new Error('db locked'))
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await AppSetting.upsert({ key: LAST_RUN_KEY, value: stale })
    await expect(runMaintenance()).rejects.toThrow('db locked')
    const row = await AppSetting.findOne({ where: { key: LAST_RUN_KEY } })
    expect(row.value).toBe(stale)
  })
})
