const learningService = require('../LearningService')
const { PreferenceSuggestion } = require('../../db/database')
const { getInstance: getAgentMdService } = require('../../agent/agentMd')

describe('LearningService.autoAcceptHighConfidence', () => {
  beforeAll(async () => {
    await PreferenceSuggestion.sync()
  })

  beforeEach(async () => {
    await PreferenceSuggestion.destroy({ truncate: true })
  })

  test('置信度 >= 0.95 的建议自动 accepted', async () => {
    await PreferenceSuggestion.bulkCreate([
      { type: 'material', payload: { value: '海螺' }, confidence: 0.98, status: 'pending' },
      { type: 'material', payload: { value: '冀东' }, confidence: 0.5, status: 'pending' }
    ])

    const result = await learningService.autoAcceptHighConfidence({ threshold: 0.95 })

    expect(result.accepted).toBe(1)
    // 高置信度的那条应 accepted
    const all = await PreferenceSuggestion.findAll({ order: [['confidence', 'DESC']] })
    expect(all[0].status).toBe('accepted')
    expect(all[1].status).toBe('pending')
  })

  test('material 建议回写到 agent.md 业务规则 > 材料 段', async () => {
    const svc = getAgentMdService()
    await svc.saveToFile('# 我的智能助手规则\n\n## 业务规则\n\n### 材料\n- 初始材料\n')

    await PreferenceSuggestion.create({
      type: 'material', payload: { value: '海螺' }, confidence: 0.98, status: 'pending'
    })

    await learningService.autoAcceptHighConfidence({ threshold: 0.95 })

    const updated = svc.getCached().raw
    expect(updated).toContain('海螺')
  })
})
