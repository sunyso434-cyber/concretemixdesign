const { listRecentSessionsWithMeta } = require('../SessionService')
const { ChatSession, ChatHistory, sequelize } = require('../../database')

describe('listRecentSessionsWithMeta 排除归档', () => {
  beforeAll(async () => { await sequelize.sync() })
  afterAll(async () => {
    await ChatHistory.destroy({ where: { sessionId: ['rec-a', 'rec-b'] } })
    await ChatSession.destroy({ where: { sessionId: ['rec-a', 'rec-b'] } })
    await sequelize.close()
  })

  test('已归档会话不出现在最近列表', async () => {
    await ChatSession.create({ sessionId: 'rec-a', sessionName: '普通', archived: false, lastActivity: new Date() })
    await ChatHistory.create({ sessionId: 'rec-a', role: 'user', content: 'hi' })
    await ChatSession.create({ sessionId: 'rec-b', sessionName: '已归档', archived: true, lastActivity: new Date() })
    await ChatHistory.create({ sessionId: 'rec-b', role: 'user', content: 'hi' })

    const list = await listRecentSessionsWithMeta(50)
    const ids = list.map(s => s.sessionId)
    expect(ids).toContain('rec-a')
    expect(ids).not.toContain('rec-b')
  })
})
