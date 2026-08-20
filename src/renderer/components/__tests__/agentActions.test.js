/**
 * agentActions.sendMessage 回归测试
 *
 * 重点：防止 antd `message` 与入参解构 `message` 在 minify 后
 * 产生 shadowing → `t.error is not a function` unhandled rejection。
 *
 * 跑法：npx jest src/renderer/components/__tests__/agentActions.test.js
 */

// --- Mock antd 捕获 message.error / message.success 调用 ---
// 注意：变量名必须以 mock 开头，Jest 才允许 jest.mock() 工厂里引用
const mockMessageError = jest.fn()
const mockMessageSuccess = jest.fn()
jest.mock('antd', () => ({
  message: {
    error: (...args) => mockMessageError(...args),
    success: (...args) => mockMessageSuccess(...args)
  }
}))

// --- Mock useAgentStore（避免引入真实 React 上下文）---
jest.mock('../AgentStore', () => ({
  useAgentStore: () => ({})
}))

// --- Mock React hooks（最小化 stub）---
jest.mock('react', () => ({
  useEffect: (fn) => fn,
  useRef: (init) => ({ current: init })
}))

// --- Mock window.electronAPI（在 beforeEach 中替换 invoke 行为）---
const invokeMock = jest.fn()
global.window = global.window || {}
window.electronAPI = {
  invoke: invokeMock
}

const { sendMessage } = require('../agentActions')

describe('sendMessage - 回归测试（防 t.error is not a function）', () => {
  let dispatch
  let capturedErrors

  beforeEach(() => {
    dispatch = jest.fn()
    mockMessageError.mockClear()
    mockMessageSuccess.mockClear()
    invokeMock.mockReset()
    // 静默 console.error / console.log 噪音
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    capturedErrors = []
    // 捕获 unhandled promise rejection
    const handler = (err) => capturedErrors.push(err)
    process.on('unhandledRejection', handler)
    return () => process.off('unhandledRejection', handler)
  })

  test('1. 空消息：直接 return，不调任何 IPC', async () => {
    await sendMessage({ dispatch, sessionId: 's1', message: '   ' })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(mockMessageError).not.toHaveBeenCalled()
  })

  test('2. 正常成功：IPC 返回 success，不应调 message.error', async () => {
    invokeMock.mockImplementation((channel) => {
      if (channel === 'agent:saveMessage') return Promise.resolve({ success: true })
      if (channel === 'agent:run') return Promise.resolve({ success: true, result: { success: true } })
      return Promise.resolve({})
    })

    await sendMessage({ dispatch, sessionId: 's1', message: '帮我设计C30' })

    expect(mockMessageError).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_MESSAGE', payload: { role: 'user', content: '帮我设计C30' } })
  })

  test('3. API Key 未配（IPC 返回 {success:false}）：message.error 必须被调用且不抛 TypeError', async () => {
    // v10.2.0：agent:run 返回 { success:false, error: <structured object> } 格式
    invokeMock.mockImplementation((channel) => {
      if (channel === 'agent:saveMessage') return Promise.resolve({ success: true })
      if (channel === 'agent:run') {
        return Promise.resolve({
          success: false,
          error: { code: 'E-LLM-401', title: 'AI 密钥无效或未配置', hint: '请到「设置」→「AI 模型」检查 API Key' }
        })
      }
      return Promise.resolve({})
    })

    await sendMessage({ dispatch, sessionId: 's1', message: 'test' })

    // v10.2.0：toast 格式升级为 [CODE] title — hint
    expect(mockMessageError).toHaveBeenCalledTimes(1)
    expect(mockMessageError).toHaveBeenCalledWith(expect.stringContaining('E-LLM-401'))
    expect(mockMessageError).toHaveBeenCalledWith(expect.stringContaining('AI 密钥无效或未配置'))
    // dispatch 应该更新 agent 状态为 error（payload 含 classifiedError + sessionId + requestId）
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ERROR',
      payload: expect.objectContaining({
        classifiedError: expect.objectContaining({ code: 'E-LLM-401' }),
        sessionId: 's1'
      })
    }))
  })

  test('4. result.success === false (max_failures_exceeded)：走 getFriendlyError 翻译路径', async () => {
    invokeMock.mockImplementation((channel) => {
      if (channel === 'agent:saveMessage') return Promise.resolve({ success: true })
      if (channel === 'agent:run') {
        return Promise.resolve({ success: true, result: { success: false, error: 'max_failures_exceeded' } })
      }
      return Promise.resolve({})
    })

    await sendMessage({ dispatch, sessionId: 's1', message: 'test' })

    expect(mockMessageError).toHaveBeenCalledTimes(1)
    expect(mockMessageError).toHaveBeenCalledWith('AI 执行失败')
  })

  test('5. IPC 真的 throw (preload 链路断裂)：catch 块必须正确调 message.error', async () => {
    invokeMock.mockImplementation((channel) => {
      if (channel === 'agent:saveMessage') return Promise.resolve({ success: true })
      if (channel === 'agent:run') throw new Error('IPC channel broken')
      return Promise.resolve({})
    })

    await sendMessage({ dispatch, sessionId: 's1', message: 'test' })

    // v10.2.0：catch 块用 [EXCEPTION] title 格式
    expect(mockMessageError).toHaveBeenCalledTimes(1)
    expect(mockMessageError).toHaveBeenCalledWith(expect.stringContaining('AI 执行异常'))
    expect(mockMessageError).toHaveBeenCalledWith(expect.stringContaining('IPC channel broken'))
    // 不应该有 unhandled rejection（catch 块应该吞掉）
    await new Promise(r => setImmediate(r))
    expect(capturedErrors).toEqual([])
  })

  test('6. userMessage 字段被正确传递到 IPC，不会与 antd message 混淆', async () => {
    let savedUserContent
    let runUserMessage
    invokeMock.mockImplementation((channel, payload) => {
      if (channel === 'agent:saveMessage') {
        savedUserContent = payload?.content
        return Promise.resolve({ success: true })
      }
      if (channel === 'agent:run') {
        runUserMessage = payload?.message
        return Promise.resolve({ success: true, result: { success: true } })
      }
      return Promise.resolve({})
    })

    await sendMessage({ dispatch, sessionId: 's1', message: '这是一条特殊消息 🎉' })

    expect(savedUserContent).toBe('这是一条特殊消息 🎉')
    expect(runUserMessage).toBe('这是一条特殊消息 🎉')
  })
})
