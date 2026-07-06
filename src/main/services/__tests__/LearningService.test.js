const learningService = require('../LearningService')
const { getSuggestionStore } = require('../../agent/preferences')

describe('LearningService.getSuggestions', () => {
  beforeEach(() => {
    const store = getSuggestionStore()
    store._items = []
  })

  test('返回建议列表（按 confidence 倒序）', () => {
    const store = getSuggestionStore()
    store._items = [
      { id: 1, confidence: 0.3, payload: { material: '海螺' } },
      { id: 2, confidence: 0.9, payload: { method: 'JGJ55' } },
      { id: 3, confidence: 0.5, payload: { material: '冀东' } }
    ]

    const result = learningService.getSuggestions()
    expect(result[0].id).toBe(2)
    expect(result[1].id).toBe(3)
    expect(result[2].id).toBe(1)
  })

  test('空建议返回空数组', () => {
    expect(learningService.getSuggestions()).toEqual([])
  })

  test('acceptSuggestion 标记 accepted', () => {
    const store = getSuggestionStore()
    store._items = [{ id: 1, confidence: 0.5, payload: { material: '海螺' }, status: 'pending' }]

    const result = learningService.acceptSuggestion(1)
    expect(result.status).toBe('accepted')
    expect(store._items[0].status).toBe('accepted')
  })
})
