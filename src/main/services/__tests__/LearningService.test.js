const learningService = require('../LearningService')
const { PreferenceSuggestion } = require('../../db/database')

describe('LearningService.getSuggestions v2 (SQLite)', () => {
  beforeEach(async () => {
    await PreferenceSuggestion.destroy({ truncate: true })
  })

  test('返回 SQLite 中 pending 的建议（按 confidence 倒序）', async () => {
    await PreferenceSuggestion.bulkCreate([
      { type: 'material', payload: { value: '海螺' }, confidence: 0.3, status: 'pending' },
      { type: 'material', payload: { value: '冀东' }, confidence: 0.9, status: 'pending' },
      { type: 'material', payload: { value: '金隅' }, confidence: 0.5, status: 'accepted' }
    ])

    const result = await learningService.getSuggestions()
    expect(result).toHaveLength(2)  // 只 pending
    expect(result[0].confidence).toBe(0.9)
    expect(result[1].confidence).toBe(0.3)
  })

  test('acceptSuggestion 标 accepted + 增 recallCount + 重置 decay', async () => {
    const s = await PreferenceSuggestion.create({
      type: 'method', payload: {}, confidence: 0.5, status: 'pending'
    })

    await learningService.acceptSuggestion(s.id)

    const fetched = await PreferenceSuggestion.findByPk(s.id)
    expect(fetched.status).toBe('accepted')
    expect(fetched.recallCount).toBe(1)
    expect(fetched.decayScore).toBeGreaterThan(0.5)
  })
})
