/**
 * agent:deleteSession IPC handler 测试
 *
 * 验证 agent:deleteSession handler 在删除 session 时会同时清理 ToolResultStore 缓存。
 * 跑法：npx jest src/main/ipcHandlers/__tests__/agentHandler.test.js
 */

const { ipcMain } = require('electron')

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  shell: { openPath: jest.fn() },
  BrowserWindow: jest.fn()
}))

// Mock ToolResultStore
const mockClear = jest.fn()
jest.mock('../../agent/ToolResultStore', () => {
  return jest.fn().mockImplementation(() => ({
    clear: mockClear
  }))
})

// Mock / stub 所有顶层依赖，使模块可加载
jest.mock('../../utils/logRotator', () => ({ rotateIfNeeded: jest.fn() }))
jest.mock('../../services/DeepSeekService', () => jest.fn())
jest.mock('../../agent/Orchestrator', () => ({ create: jest.fn() }))
jest.mock('../../agent/SkillRegistry', () => jest.fn())
jest.mock('../../agent/SkillExecutor', () => jest.fn())
jest.mock('../../agent/DynamicContextProvider', () => jest.fn())
jest.mock('../../agent/SkillDebugger', () => jest.fn())
jest.mock('../../agent/workspaceTools', () => ({ buildWorkspaceSkills: jest.fn() }))
jest.mock('../../services/AgentMemoryService', () => ({
  deleteSession: jest.fn().mockResolvedValue(),
  getHistory: jest.fn().mockResolvedValue([]),
}))
jest.mock('../../services/SystemService', () => ({}))
jest.mock('../../agent/errorClassifier', () => ({ classifyError: jest.fn() }))
jest.mock('../../db/services/SessionService', () => ({}))
jest.mock('../archiveSessionCore', () => ({ applyArchive: jest.fn() }))
jest.mock('../../agent/agentMd', () => ({ getInstance: jest.fn() }))
jest.mock('../../agent/agentMd/AgentMdParser', () => ({ AgentMdParser: { formatToMarkdown: jest.fn(), parse: jest.fn() } }))
jest.mock('../../agent/preferences', () => ({ getSuggestionStore: jest.fn() }))
jest.mock('../../services/LearningService', () => ({}))
jest.mock('../../db/database', () => ({}))

const { registerAgentHandlers } = require('../agentHandler')

describe('agent:deleteSession IPC handler', () => {
  let deleteSessionHandler

  beforeEach(() => {
    jest.clearAllMocks()
    mockClear.mockClear()
    ipcMain.handle.mockClear()

    registerAgentHandlers()
    const call = ipcMain.handle.mock.calls.find(c => c[0] === 'agent:deleteSession')
    // 如果之前注册过，取最后一次
    const lastCall = ipcMain.handle.mock.calls.filter(c => c[0] === 'agent:deleteSession').pop()
    deleteSessionHandler = lastCall ? lastCall[1] : (call ? call[1] : null)
  })

  test('删除 session 时调用 ToolResultStore.clear', async () => {
    const result = await deleteSessionHandler({}, { sessionId: 'test-sess-123' })
    expect(result).toEqual({ success: true })
    expect(mockClear).toHaveBeenCalledWith('test-sess-123')
  })

  test('ToolResultStore.clear 抛错时不影响正常返回', async () => {
    mockClear.mockImplementationOnce(() => { throw new Error('磁盘写入失败') })
    const result = await deleteSessionHandler({}, { sessionId: 'test-sess-456' })
    expect(result).toEqual({ success: true })
    // clear 确实调用了，只是抛了错
    expect(mockClear).toHaveBeenCalledWith('test-sess-456')
  })
})
