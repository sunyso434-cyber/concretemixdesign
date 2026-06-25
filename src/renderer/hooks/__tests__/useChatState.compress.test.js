// src/renderer/hooks/__tests__/useChatState.compress.test.js
//
// useChatState.compress 测试
// 注：useChatState 是 hook，本项目 jest 环境是 node + 无 @testing-library/react。
// 参考 src/renderer/components/__tests__/agentActions.test.js 的模式：
// 用 jest.mock('react', ...) 桩 React 钩子，然后调用从 useChatState 单独导出的
// 纯函数 handleCompressContextImpl 来验证行为。

// --- Mock antd 捕获 message.error / message.success / message.info ---
const mockMessageError = jest.fn()
const mockMessageSuccess = jest.fn()
const mockMessageInfo = jest.fn()
jest.mock('antd', () => ({
  message: {
    error: (...args) => mockMessageError(...args),
    success: (...args) => mockMessageSuccess(...args),
    info: (...args) => mockMessageInfo(...args)
  }
}))

// --- Mock window.electronAPI（在 beforeEach 中替换 invoke 行为）---
const invokeMock = jest.fn()
global.window = global.window || {}
window.electronAPI = {
  invoke: invokeMock
}

// 静默 console 噪音
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

// --- 简单 mock React hooks（参照 agentActions.test.js）---
// 这让我们能 require useChatState 并直接调用 hook 函数，
// 拿到它的返回值进行形状断言。
jest.mock('react', () => ({
  useState: (init) => [init, jest.fn()],
  useEffect: (fn) => fn,
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn
}))

// --- Mock useAgentStore 避免拉入 JSX 文件 ---
jest.mock('../../components/AgentStore', () => ({
  useAgentStore: () => ({
    state: { messages: [] },
    dispatch: jest.fn()
  })
}))

const useChatState = require('../useChatState').default

const { handleCompressContextImpl } = require('../useChatState.compress')

describe('useChatState - handleCompressContext', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    mockMessageError.mockClear()
    mockMessageSuccess.mockClear()
    mockMessageInfo.mockClear()
    invokeMock.mockResolvedValue({
      success: true,
      data: {
        summary: '## Goal\n测试摘要',
        recentMessages: [{ role: 'user', content: 'msg2' }],
        realTokens: 1000
      }
    })
  })

  test('成功后 dispatch COMPRESS_MESSAGES 和 SET_CONTEXT_STATS', async () => {
    const dispatch = jest.fn()
    const setPreviousSummary = jest.fn()
    const setIsCompressing = jest.fn()

    await handleCompressContextImpl({
      dispatch,
      setIsCompressing,
      setPreviousSummary,
      messages: [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'reply1' },
        { role: 'user', content: 'msg2' }
      ],
      previousSummary: ''
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'COMPRESS_MESSAGES',
      payload: {
        summary: '## Goal\n测试摘要',
        recentMessages: [{ role: 'user', content: 'msg2' }]
      }
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: 1000 }
    })
    expect(setPreviousSummary).toHaveBeenCalledWith('## Goal\n测试摘要')
    expect(setIsCompressing).toHaveBeenCalledWith(false)  // finally block
    expect(mockMessageSuccess).toHaveBeenCalledWith('上下文已压缩')
  })

  test('失败时不 dispatch 并设回 isCompressing', async () => {
    invokeMock.mockRejectedValueOnce(new Error('网络错误'))
    const dispatch = jest.fn()
    const setPreviousSummary = jest.fn()
    const setIsCompressing = jest.fn()

    await handleCompressContextImpl({
      dispatch,
      setIsCompressing,
      setPreviousSummary,
      messages: [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'reply1' },
        { role: 'user', content: 'msg2' }
      ],
      previousSummary: ''
    })

    expect(dispatch).not.toHaveBeenCalled()
    expect(setIsCompressing).toHaveBeenCalledWith(false)  // finally block
    expect(setPreviousSummary).not.toHaveBeenCalled()
    expect(mockMessageError).toHaveBeenCalledWith('压缩失败：网络错误')
  })

  test('messages 少于 2 轮时直接返回', async () => {
    const dispatch = jest.fn()
    const setPreviousSummary = jest.fn()
    const setIsCompressing = jest.fn()

    await handleCompressContextImpl({
      dispatch,
      setIsCompressing,
      setPreviousSummary,
      messages: [{ role: 'user', content: 'only one' }],
      previousSummary: ''
    })

    expect(invokeMock).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(setIsCompressing).not.toHaveBeenCalledWith(true)
    expect(mockMessageInfo).toHaveBeenCalledWith('对话过短，无需压缩')
  })
})

describe('useChatState - 暴露压缩相关字段', () => {
  test('返回值包含 isCompressing / previousSummary / handleCompressContext', () => {
    const state = useChatState()
    expect(state).toHaveProperty('isCompressing')
    expect(state).toHaveProperty('previousSummary')
    expect(state).toHaveProperty('setPreviousSummary')
    expect(typeof state.handleCompressContext).toBe('function')
  })
})
