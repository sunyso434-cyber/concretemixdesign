const { cleanupOldSessions } = require('../SessionCleanupService')
const { ChatSession, ChatHistory } = require('../../database')

describe('cleanupOldSessions', () => {
  afterAll(async () => {
    // 清理测试数据
    await ChatHistory.destroy({ where: { sessionId: ['old-1', 'new-1'] } })
    await ChatSession.destroy({ where: { sessionId: ['old-1', 'new-1'] } })
  })

  test('清理 30 天前的会话保留活跃会话', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    await ChatSession.create({ sessionId: 'old-1', lastActivity: oldDate })
    await ChatHistory.create({ sessionId: 'old-1', role: 'user', content: 'old' })
    await ChatSession.create({ sessionId: 'new-1', lastActivity: new Date() })
    await ChatHistory.create({ sessionId: 'new-1', role: 'user', content: 'new' })

    const result = await cleanupOldSessions({ keepDays: 30 })

    expect(result.deleted).toBeGreaterThan(0)
    const remaining = await ChatHistory.count({ where: { sessionId: 'new-1' } })
    expect(remaining).toBe(1)
    const oldRemaining = await ChatHistory.count({ where: { sessionId: 'old-1' } })
    expect(oldRemaining).toBe(0)
  })
})
