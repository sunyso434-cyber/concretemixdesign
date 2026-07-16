const { ChatSession, sequelize } = require('../database')

describe('ChatSession.archived', () => {
  beforeAll(async () => { await sequelize.sync() })
  afterAll(async () => {
    await ChatSession.destroy({ where: { sessionId: ['arch-test-1'] } })
    await sequelize.close()
  })

  test('新建会话 archived 默认 false', async () => {
    await ChatSession.create({ sessionId: 'arch-test-1' })
    const s = await ChatSession.findOne({ where: { sessionId: 'arch-test-1' } })
    expect(s.archived).toBe(false)
  })
})
