'use strict'

const { PreferenceSuggestion, sequelize } = require('../../database')

describe('PreferenceSuggestion model', () => {
  beforeAll(async () => {
    await PreferenceSuggestion.sync()
  })

  afterAll(async () => {
    await PreferenceSuggestion.destroy({ truncate: true })
    await sequelize.close()
  })

  test('创建+读取 material 类建议', async () => {
    const row = await PreferenceSuggestion.create({
      type: 'material',
      payload: { category: '水泥', dimension: '厂家', value: '海螺' },
      confidence: 0.85,
      status: 'pending'
    })
    const fetched = await PreferenceSuggestion.findByPk(row.id)
    expect(fetched.payload.value).toBe('海螺')
    expect(fetched.status).toBe('pending')
  })

  test('status 枚举: pending/accepted/rejected', async () => {
    const a = await PreferenceSuggestion.create({ type: 'method', payload: {}, confidence: 0.5, status: 'accepted' })
    const b = await PreferenceSuggestion.create({ type: 'correction', payload: {}, confidence: 0.3, status: 'rejected' })
    expect(a.status).toBe('accepted')
    expect(b.status).toBe('rejected')
  })
})
