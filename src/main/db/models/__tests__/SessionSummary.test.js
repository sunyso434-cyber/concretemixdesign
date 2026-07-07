'use strict'

// 路径修正：test 在 src/main/db/models/__tests__/，所以 ../../database 才能到 src/main/db/database
const { SessionSummary, sequelize } = require('../../database')

describe('SessionSummary model', () => {
  beforeAll(async () => {
    await sequelize.sync({ force: false })
  })

  afterAll(async () => {
    await SessionSummary.destroy({ truncate: true })
    await sequelize.close()
  })

  test('创建会话摘要 + 字段读写', async () => {
    const row = await SessionSummary.create({
      sessionId: 's1',
      rangeStart: 1,
      rangeEnd: 20,
      summary: '老板确认了 C30 配合比，砂率 36%',
      keyDecisions: ['砂率 36%', 'P.O42.5 水泥'],
      toolCalls: ['calculate_mix_design'],
      decayScore: 1.0
    })
    expect(row.id).toBeDefined()
    expect(row.decayScore).toBe(1.0)

    const fetched = await SessionSummary.findByPk(row.id)
    expect(fetched.keyDecisions).toEqual(['砂率 36%', 'P.O42.5 水泥'])
  })

  test('FTS5 全文检索命中', async () => {
    await SessionSummary.create({
      sessionId: 's2', rangeStart: 1, rangeEnd: 10,
      summary: '讨论了 JGJ 55-2011 标准的砂率取值'
    })
    // FTS5 MATCH 必须在 fts 虚拟表上：session_summaries_fts 是 rowid 别名表，rowid = session_summaries.id
    const results = await sequelize.query(
      "SELECT rowid AS id FROM session_summaries_fts WHERE session_summaries_fts MATCH 'JGJ' LIMIT 1",
      { type: sequelize.QueryTypes.SELECT }
    )
    expect(results.length).toBeGreaterThan(0)
  })
})
