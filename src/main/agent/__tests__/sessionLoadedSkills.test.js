/**
 * sessionLoadedSkills 单元测试（技能目录式路由 · T1）
 */

const { SessionLoadedSkills } = require('../sessionLoadedSkills')

describe('SessionLoadedSkills', () => {
  let store

  beforeEach(() => {
    store = new SessionLoadedSkills()
  })

  test('load：正常登记返回 true，get 返回名字数组', () => {
    expect(store.load('s1', 'calculate_mix_design')).toBe(true)
    expect(store.get('s1')).toEqual(['calculate_mix_design'])
  })

  test('load：幂等——重复登记不产生重复项', () => {
    store.load('s1', 'manage_materials')
    store.load('s1', 'manage_materials')
    expect(store.get('s1')).toEqual(['manage_materials'])
  })

  test('load：sessionId 或 name 缺失时静默拒绝', () => {
    expect(store.load(null, 'a')).toBe(false)
    expect(store.load('s1', '')).toBe(false)
    expect(store.get('s1')).toEqual([])
  })

  test('has：已加载返回 true，未加载/未知会话返回 false', () => {
    store.load('s1', 'web_search')
    expect(store.has('s1', 'web_search')).toBe(true)
    expect(store.has('s1', 'save_mix_design')).toBe(false)
    expect(store.has('unknown-session', 'web_search')).toBe(false)
  })

  test('会话隔离：两个会话互不影响', () => {
    store.load('s1', 'a_skill')
    store.load('s2', 'b_skill')
    expect(store.get('s1')).toEqual(['a_skill'])
    expect(store.get('s2')).toEqual(['b_skill'])
    expect(store.has('s1', 'b_skill')).toBe(false)
  })

  test('cleanup：只清理指定会话', () => {
    store.load('s1', 'a_skill')
    store.load('s2', 'b_skill')
    store.cleanup('s1')
    expect(store.get('s1')).toEqual([])
    expect(store.get('s2')).toEqual(['b_skill'])
  })

  test('reset：清空全部', () => {
    store.load('s1', 'a_skill')
    store.load('s2', 'b_skill')
    store.reset()
    expect(store.get('s1')).toEqual([])
    expect(store.get('s2')).toEqual([])
  })
})
