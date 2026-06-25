// src/main/ipcHandlers/__tests__/aiAnalysisHandler.compress.test.js
//
// Task 5 - 测试 aiAnalysis:compressContext IPC handler
// 验证：
//   1. 成功路径：返回 {success: true, data: {summary, recentMessages, realTokens}}
//   2. 失败路径：捕获 service.compressContext 抛错，返回 {success: false, error}
//
// 测试策略：mock 'electron' 与 DeepSeekService，让 registerAiAnalysisHandlers
// 注入我们提供的 deepseekMock，通过 ipcMain.handle mock.calls 反查 handler。

const { ipcMain } = require('electron')

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  BrowserWindow: jest.fn()
}))

const { registerAiAnalysisHandlers } = require('../aiAnalysisHandler')

describe('aiAnalysisHandler - compressContext', () => {
  let compressHandler
  let deepseekMock

  beforeEach(() => {
    ipcMain.handle.mockClear()
    deepseekMock = {
      compressContext: jest.fn().mockResolvedValue({
        summary: '## Goal\n测试摘要',
        recentMessages: [{ role: 'user', content: 'recent' }],
        realTokens: 123
      })
    }
    registerAiAnalysisHandlers({
      getDeepSeekService: () => deepseekMock
    })
    // 反查 aiAnalysis:compressContext handler
    const call = ipcMain.handle.mock.calls.find(c => c[0] === 'aiAnalysis:compressContext')
    compressHandler = call[1]
  })

  test('成功时返回 success + data', async () => {
    const result = await compressHandler({}, {
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      previousSummary: ''
    })
    expect(result.success).toBe(true)
    expect(result.data.summary).toBe('## Goal\n测试摘要')
    expect(result.data.realTokens).toBe(123)
  })

  test('错误时返回 success=false + error', async () => {
    deepseekMock.compressContext.mockRejectedValueOnce(new Error('对话过短'))
    const result = await compressHandler({}, { messages: [], previousSummary: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('对话过短')
  })

  test('service 不存在时返回 success=false', async () => {
    // 重新注册，使用一个返回 null 的 service 工厂
    ipcMain.handle.mockClear()
    registerAiAnalysisHandlers({
      getDeepSeekService: () => null
    })
    const nullCall = ipcMain.handle.mock.calls.find(c => c[0] === 'aiAnalysis:compressContext')
    const nullHandler = nullCall[1]
    const result = await nullHandler({}, { messages: [], previousSummary: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('DeepSeek')
  })
})