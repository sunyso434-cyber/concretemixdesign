// workspaceHandler.writeFile.test.js（Task 3.2）
// 测试 workspaceHandler.js 注册的 workspace:writeFile IPC：
//   - 注册阶段注册该 channel
//   - 调用 write-handler.writeFile 并返回结果
//   - write-handler 抛 NOT_OPEN → ErrorCodes 格式
//   - write-handler 抛 WRITE_FAIL → ErrorCodes 格式
const handlers = {}
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, fn) => {
      handlers[channel] = fn
    })
  }
}))

const mockManager = {
  open: jest.fn(),
  close: jest.fn(),
  current: jest.fn(),
  listFiles: jest.fn(),
  watch: jest.fn(),
  unwatch: jest.fn()
}

// write-handler mock：避免真实文件依赖（jest.mock factory 只能用 mock* 前缀变量）
const mockWriteHandler = {
  writeFile: jest.fn()
}
jest.mock('../../workspace/write-handler', () => mockWriteHandler)

const workspaceHandler = require('../../ipcHandlers/workspaceHandler')

describe('workspaceHandler workspace:writeFile（Task 3.2）', () => {
  beforeEach(() => {
    Object.keys(handlers).forEach(k => delete handlers[k])
    mockManager.open.mockReset()
    mockManager.close.mockReset()
    mockManager.current.mockReset()
    mockManager.listFiles.mockReset()
    mockManager.watch.mockReset()
    mockManager.unwatch.mockReset()
    mockWriteHandler.writeFile.mockReset()
    workspaceHandler.register({ workspaceManager: mockManager })
  })

  test('注册 workspace:writeFile channel', () => {
    expect(handlers['workspace:writeFile']).toBeDefined()
  })

  test('成功 → 调 write-handler.writeFile 并返回 { path, size, savedAt }', async () => {
    mockWriteHandler.writeFile.mockResolvedValue({
      path: '/ws/reports/r.docx',
      size: 12345,
      savedAt: '2026-06-19T12:00:00.000Z'
    })

    const result = await handlers['workspace:writeFile']({}, {
      type: 'docx',
      filename: 'r.docx',
      payload: { title: 't', sections: [] }
    })

    expect(mockWriteHandler.writeFile).toHaveBeenCalledWith({
      workspaceManager: mockManager,
      type: 'docx',
      filename: 'r.docx',
      payload: { title: 't', sections: [] }
    })
    expect(result).toEqual({
      path: '/ws/reports/r.docx',
      size: 12345,
      savedAt: '2026-06-19T12:00:00.000Z'
    })
  })

  test('write-handler 抛 WorkspaceError(NOT_OPEN) → ErrorCodes 格式', async () => {
    const { WorkspaceError } = require('../../workspace/WorkspaceError')
    mockWriteHandler.writeFile.mockRejectedValue(
      new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    )

    const result = await handlers['workspace:writeFile']({}, {
      type: 'md',
      filename: 'a.md',
      payload: { title: 't', sections: [] }
    })

    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_OPEN')
    expect(result.title).toContain('工作区未打开')
  })

  test('write-handler 抛 WorkspaceError(WRITE_FAIL) → ErrorCodes 格式', async () => {
    const { WorkspaceError } = require('../../workspace/WorkspaceError')
    mockWriteHandler.writeFile.mockRejectedValue(
      new WorkspaceError('WRITE_FAIL', '写入文件失败', true)
    )

    const result = await handlers['workspace:writeFile']({}, {
      type: 'xlsx',
      filename: 'a.xlsx',
      payload: { title: 't', sections: [] }
    })

    expect(result.success).toBe(false)
    expect(result.code).toBe('WRITE_FAIL')
  })
})