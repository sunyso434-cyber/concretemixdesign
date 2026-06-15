const { SuggestionStore } = require('../suggestionStore')

const sampleSuggestion = (overrides = {}) => ({
  id: 'sugg-1',
  type: 'material_vendor',
  title: '测试建议',
  proposedYaml: { category: '水泥', dimension: '厂家', value: '拉法基' },
  reason: '5次中5次',
  confidence: 1.0,
  createdAt: new Date(),
  status: 'pending',
  ...overrides
})

describe('SuggestionStore', () => {
  let store
  let mockWebContents
  beforeEach(() => {
    store = new SuggestionStore()
    mockWebContents = { send: jest.fn(), isDestroyed: () => false }
    store.registerWebContents(mockWebContents)
  })

  test('add 应追加建议并推送事件', () => {
    const sugg = sampleSuggestion()
    store.add(sugg)
    expect(store.list()).toEqual([sugg])
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:suggestions:new', {
      suggestions: [sugg]
    })
  })

  test('add 重复 id 应忽略', () => {
    const sugg = sampleSuggestion()
    store.add(sugg)
    store.add(sugg)
    expect(store.list()).toHaveLength(1)
  })

  test('acceptById 应返回被采纳的建议并从列表移除', () => {
    const sugg = sampleSuggestion()
    store.add(sugg)
    const result = store.acceptById('sugg-1')
    expect(result).toEqual(sugg)
    expect(store.list()).toEqual([])
  })

  test('acceptById 不存在的 id 应返回 null', () => {
    const result = store.acceptById('not-found')
    expect(result).toBeNull()
  })

  test('dismissById 应从列表移除并返回 true', () => {
    const sugg = sampleSuggestion()
    store.add(sugg)
    expect(store.dismissById('sugg-1')).toBe(true)
    expect(store.list()).toEqual([])
  })

  test('registerWebContents 后 webContents 销毁不应 throw', () => {
    mockWebContents.isDestroyed = () => true
    expect(() => store.add(sampleSuggestion())).not.toThrow()
  })
})
