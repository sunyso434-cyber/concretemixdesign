const { applyArchive } = require('../ipcHandlers/archiveSessionCore')
const { ChatSession, sequelize } = require('../db/database')

describe('applyArchive', () => {
  beforeAll(async () => { await sequelize.sync() })
  afterAll(async () => {
    await ChatSession.destroy({ where: { sessionId: ['arc-1', 'arc-2', 'arc-run'] } })
    await sequelize.close()
  })

  test('批量归档非运行会话，运行中会话被跳过', async () => {
    await ChatSession.create({ sessionId: 'arc-1', archived: false })
    await ChatSession.create({ sessionId: 'arc-2', archived: false })
    await ChatSession.create({ sessionId: 'arc-run', archived: false })

    const isRunning = (sid) => sid === 'arc-run'
    const res = await applyArchive({
      sessionIds: ['arc-1', 'arc-2', 'arc-run'],
      archived: true,
      isRunning,
      ChatSession
    })

    expect(res.updated).toBe(2)
    expect(res.skipped).toEqual(['arc-run'])
    expect((await ChatSession.findByPk('arc-1')).archived).toBe(true)
    expect((await ChatSession.findByPk('arc-run')).archived).toBe(false)
  })

  test('恢复不受运行锁限制', async () => {
    const isRunning = () => true
    const res = await applyArchive({
      sessionIds: ['arc-1'], archived: false, isRunning, ChatSession
    })
    expect(res.updated).toBe(1)
    expect((await ChatSession.findByPk('arc-1')).archived).toBe(false)
  })
})
