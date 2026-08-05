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

// Mock todo-manage（阶段 3 任务 3.3：todo:replace-plan / todo:confirm-plan / todo:clear 委托执行）
const mockTodoManageExecute = jest.fn()
jest.mock('../../skills/todo-manage', () => ({
  execute: mockTodoManageExecute
}))

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

// === 阶段 3 任务 3.3：todo:replace-plan / todo:confirm-plan / todo:clear 计划审批 IPC ===
// 验证三个 handler 均委托 todo_manage.execute，并携带正确 action / sessionId / steps
describe('todo 计划审批 IPC handlers', () => {
  let replacePlanHandler, confirmPlanHandler, clearHandler

  beforeEach(() => {
    jest.clearAllMocks()
    ipcMain.handle.mockClear()
    registerAgentHandlers()
    const calls = ipcMain.handle.mock.calls
    replacePlanHandler = calls.filter(c => c[0] === 'todo:replace-plan').pop()?.[1]
    confirmPlanHandler = calls.filter(c => c[0] === 'todo:confirm-plan').pop()?.[1]
    clearHandler = calls.filter(c => c[0] === 'todo:clear').pop()?.[1]
  })

  test('todo:replace-plan 委托 todo_manage action=replace_plan + steps', async () => {
    mockTodoManageExecute.mockResolvedValue({ success: true, todos: [], pendingApproval: false })
    const steps = [{ id: 's1', content: '查规范' }, { content: '做配合比' }]

    const result = await replacePlanHandler({}, { sessionId: 'test-plan-1', steps })

    expect(mockTodoManageExecute).toHaveBeenCalledWith(
      { action: 'replace_plan', steps },
      expect.objectContaining({ sessionId: 'test-plan-1' })
    )
    expect(result).toEqual({ success: true, todos: [], pendingApproval: false })
  })

  test('todo:replace-plan 缺 sessionId 返回错误且不调 skill', async () => {
    const result = await replacePlanHandler({}, { steps: [{ content: 'A' }] })
    expect(result.success).toBe(false)
    expect(mockTodoManageExecute).not.toHaveBeenCalled()
  })

  test('todo:replace-plan 缺 steps / steps 为空 返回错误', async () => {
    const r1 = await replacePlanHandler({}, { sessionId: 's1' })
    expect(r1.success).toBe(false)
    const r2 = await replacePlanHandler({}, { sessionId: 's1', steps: [] })
    expect(r2.success).toBe(false)
    expect(mockTodoManageExecute).not.toHaveBeenCalled()
  })

  test('todo:replace-plan skill 抛错时返回失败', async () => {
    mockTodoManageExecute.mockRejectedValue(new Error('todo-manage 内部错误'))
    const result = await replacePlanHandler({}, { sessionId: 's1', steps: [{ content: 'A' }] })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/todo-manage/)
  })

  test('todo:confirm-plan 委托 todo_manage action=approve_plan', async () => {
    mockTodoManageExecute.mockResolvedValue({ success: true, pendingApproval: false })
    const result = await confirmPlanHandler({}, { sessionId: 'test-plan-2' })

    expect(mockTodoManageExecute).toHaveBeenCalledWith(
      { action: 'approve_plan' },
      expect.objectContaining({ sessionId: 'test-plan-2' })
    )
    expect(result.success).toBe(true)
    expect(result.pendingApproval).toBe(false)
  })

  test('todo:confirm-plan 缺 sessionId 返回错误', async () => {
    const result = await confirmPlanHandler({}, {})
    expect(result.success).toBe(false)
    expect(mockTodoManageExecute).not.toHaveBeenCalled()
  })

  test('todo:clear 委托 todo_manage action=clear', async () => {
    mockTodoManageExecute.mockResolvedValue({ success: true, todos: [], pendingApproval: false })
    const result = await clearHandler({}, { sessionId: 'test-plan-3' })

    expect(mockTodoManageExecute).toHaveBeenCalledWith(
      { action: 'clear' },
      expect.objectContaining({ sessionId: 'test-plan-3' })
    )
    expect(result.success).toBe(true)
  })

  test('todo:clear 缺 sessionId 返回错误', async () => {
    const result = await clearHandler({}, {})
    expect(result.success).toBe(false)
    expect(mockTodoManageExecute).not.toHaveBeenCalled()
  })
})
