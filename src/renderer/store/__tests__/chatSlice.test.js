// chatSlice 单元测试（优化项 5 验收：新 slice 有对应测试）
// 纯 reducer 测试，node 环境即可（经 babel 转译 ES import）
import reducer, {
  setSessions,
  setCurrentSession,
  clearCurrentSession,
  streamStarted,
  streamDelta,
  streamEnded,
  streamReset,
} from '../chatSlice'

describe('chatSlice', () => {
  test('初始状态：空会话、无焦点会话、无流式', () => {
    const state = reducer(undefined, { type: '@@INIT' })
    expect(state).toEqual({
      sessions: [],
      currentSessionId: null,
      streaming: { sessionId: null, isStreaming: false, content: '' },
    })
  })

  test('setSessions 写入会话列表（空值兜底为空数组）', () => {
    const s1 = reducer(undefined, setSessions([{ sessionId: 'a1', lastActivity: '2026-08-21', sessionName: '会话A' }]))
    expect(s1.sessions).toHaveLength(1)
    expect(s1.sessions[0].sessionName).toBe('会话A')
    const s2 = reducer(s1, setSessions(null))
    expect(s2.sessions).toEqual([])
  })

  test('setCurrentSession / clearCurrentSession 维护当前会话', () => {
    let state = reducer(undefined, setCurrentSession('s_42'))
    expect(state.currentSessionId).toBe('s_42')
    state = reducer(state, clearCurrentSession())
    expect(state.currentSessionId).toBeNull()
  })

  test('streamStarted 记录会话并归零内容', () => {
    const state = reducer(undefined, streamStarted('s_1'))
    expect(state.streaming).toEqual({ sessionId: 's_1', isStreaming: true, content: '' })
  })

  test('streamDelta 追加同会话内容', () => {
    let state = reducer(undefined, streamStarted('s_1'))
    state = reducer(state, streamDelta({ sessionId: 's_1', content: '你' }))
    state = reducer(state, streamDelta({ sessionId: 's_1', content: '好' }))
    expect(state.streaming.content).toBe('你好')
  })

  test('streamDelta 忽略非当前流式会话的增量（防多会话串流）', () => {
    let state = reducer(undefined, streamStarted('s_1'))
    state = reducer(state, streamDelta({ sessionId: 's_other', content: '串流' }))
    expect(state.streaming.content).toBe('')
    expect(state.streaming.sessionId).toBe('s_1')
  })

  test('streamEnded 保留内容仅标记结束；streamReset 完全清空', () => {
    let state = reducer(undefined, streamStarted('s_1'))
    state = reducer(state, streamDelta({ sessionId: 's_1', content: '结果' }))
    state = reducer(state, streamEnded())
    expect(state.streaming.isStreaming).toBe(false)
    expect(state.streaming.content).toBe('结果')
    state = reducer(state, streamReset())
    expect(state.streaming).toEqual({ sessionId: null, isStreaming: false, content: '' })
  })

  test('新会话流式开始会覆盖上一次流式残留', () => {
    let state = reducer(undefined, streamStarted('s_old'))
    state = reducer(state, streamDelta({ sessionId: 's_old', content: '旧内容' }))
    state = reducer(state, streamStarted('s_new'))
    expect(state.streaming).toEqual({ sessionId: 's_new', isStreaming: true, content: '' })
  })
})