// src/main/ipcHandlers/__tests__/aiAnalysisHandler.compress.test.js
//
// Task 5 - 测试 aiAnalysis:compressContext IPC handler
// 验证：
//   1. 成功路径：返回 {success: true, data: {summary, recentMessages, realTokens}}
//   2. 失败路径：捕获 service.compressContext 抛错，返回 {success: false, error}
//
// v8.4.2 更新：compressContext 已接入 tryWithFailover，不再走 getDeepSeekService 单例。
// 改为直接调 SystemService.getLlmConfigs() + new DeepSeekService(config)。

const { ipcMain } = require('electron')

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  BrowserWindow: jest.fn()
}))

// mock SystemService.getLlmConfigs 返回测试用配置
const mockConfigs = [
  { id: 'test-1', name: '测试模型', provider: 'deepseek', apiKey: 'sk-test', baseUrl: 'https://api.test.com/v1', model: 'test-model', contextLimit: 800000 }
]
let mockConfigsReturn = mockConfigs

jest.mock('../../services/SystemService', () => ({
  getLlmConfigs: jest.fn(() => mockConfigsReturn),
  getActiveLlmConfig: jest.fn(() => mockConfigsReturn[0]),
}))

// mock DeepSeekService 构造函数
const mockCompressContext = jest.fn().mockResolvedValue({
  summary: '## Goal\n测试摘要',
  recentMessages: [{ role: 'user', content: 'recent' }],
  realTokens: 123
})
jest.mock('../../services/DeepSeekService', () => {
  return jest.fn().mockImplementation(() => ({
    compressContext: mockCompressContext,
    chatStream: jest.fn(),
    clearHistory: jest.fn(),
  }))
})

const { registerAiAnalysisHandlers } = require('../aiAnalysisHandler')

describe('aiAnalysisHandler - compressContext', () => {
  let compressHandler

  beforeEach(() => {
    ipcMain.handle.mockClear()
    mockCompressContext.mockClear()
    mockConfigsReturn = [...mockConfigs]  // reset

    registerAiAnalysisHandlers({})
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
    mockCompressContext.mockRejectedValueOnce(new Error('对话过短'))
    const result = await compressHandler({}, { messages: [], previousSummary: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('对话过短')
  })

  test('无配置时返回 success=false', async () => {
    mockConfigsReturn = []  // 空配置列表
    const result = await compressHandler({}, { messages: [], previousSummary: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('未配置')
  })
})
