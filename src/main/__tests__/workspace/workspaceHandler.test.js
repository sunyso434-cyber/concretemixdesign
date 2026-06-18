// Mock electron 模块：在 workspaceHandler.js require 时生效
const handlers = {}
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, fn) => {
      handlers[channel] = fn
    })
  }
}))

// Mock WorkspaceManager：避免真实文件系统依赖
const mockManager = {
  open: jest.fn(),
  close: jest.fn(),
  current: jest.fn(),
  listFiles: jest.fn()
}
jest.mock('../../workspace/WorkspaceManager', () => ({
  WorkspaceManager: jest.fn().mockImplementation(() => mockManager)
}))

const workspaceHandler = require('../../ipcHandlers/workspaceHandler')

describe('workspaceHandler IPC (Task 1.9)', () => {
  beforeEach(() => {
    // 清空 mock 调用记录和已注册的 handlers
    Object.keys(handlers).forEach(k => delete handlers[k])
    mockManager.open.mockReset()
    mockManager.close.mockReset()
    mockManager.current.mockReset()
    mockManager.listFiles.mockReset()
  })

  describe('register() 注册阶段', () => {
    test('注册 4 个 IPC handler（channel 名正确）', () => {
      workspaceHandler.register({
        workspaceManager: mockManager,
        wikiEngine: null,
        kgExtractor: null
      })

      expect(handlers['workspace:open']).toBeDefined()
      expect(handlers['workspace:close']).toBeDefined()
      expect(handlers['workspace:current']).toBeDefined()
      expect(handlers['workspace:listFiles']).toBeDefined()
    })

    test('register 接受 wikiEngine/kgExtractor null（v1.5.3 多实例契约）', () => {
      expect(() => {
        workspaceHandler.register({ workspaceManager: mockManager })
      }).not.toThrow()
    })
  })

  describe('workspace:open', () => {
    beforeEach(() => {
      workspaceHandler.register({ workspaceManager: mockManager })
    })

    test('成功 → 透传 workspaceManager.open() 的返回值', async () => {
      mockManager.open.mockResolvedValue({ path: '/ws', status: 'ready' })

      const result = await handlers['workspace:open']({}, { path: '/ws' })

      expect(mockManager.open).toHaveBeenCalledWith('/ws')
      expect(result).toEqual({ path: '/ws', status: 'ready' })
    })

    test('抛 WorkspaceError → 转 ErrorCodes 格式', async () => {
      const { WorkspaceError } = require('../../workspace/WorkspaceError')
      mockManager.open.mockRejectedValue(new WorkspaceError('PATH_INVALID', '路径无效', false))

      const result = await handlers['workspace:open']({}, { path: '/bad' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('PATH_INVALID')
      expect(result.error).toContain('路径无效')
    })

    test('抛普通 Error → 包装为 UNKNOWN', async () => {
      mockManager.open.mockRejectedValue(new Error('disk error'))

      const result = await handlers['workspace:open']({}, { path: '/x' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('UNKNOWN')
    })
  })

  describe('workspace:close', () => {
    beforeEach(() => {
      workspaceHandler.register({ workspaceManager: mockManager })
    })

    test('成功 → 返回 { ok: true } 并调用 workspaceManager.close()', async () => {
      const result = await handlers['workspace:close']({})

      expect(mockManager.close).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ ok: true })
    })
  })

  describe('workspace:current', () => {
    beforeEach(() => {
      workspaceHandler.register({ workspaceManager: mockManager })
    })

    test('工作区未打开 → 返回 null', async () => {
      mockManager.current.mockReturnValue(null)

      const result = await handlers['workspace:current']({})

      expect(result).toBeNull()
    })

    test('工作区已打开 → 返回 { path, status }', async () => {
      mockManager.current.mockReturnValue({ path: '/ws', status: 'ready' })

      const result = await handlers['workspace:current']({})

      expect(result).toEqual({ path: '/ws', status: 'ready' })
    })
  })

  describe('workspace:listFiles', () => {
    beforeEach(() => {
      workspaceHandler.register({ workspaceManager: mockManager })
    })

    test('成功 → 返回 { files: [...] }', async () => {
      const files = [{ name: 'a.md', path: 'a.md' }]
      mockManager.listFiles.mockResolvedValue(files)

      const result = await handlers['workspace:listFiles']({}, { subdir: 'root' })

      expect(mockManager.listFiles).toHaveBeenCalledWith('root')
      expect(result).toEqual({ files })
    })

    test('未打开工作区 → 抛 NOT_OPEN 转 ErrorCodes 格式', async () => {
      const { WorkspaceError } = require('../../workspace/WorkspaceError')
      mockManager.listFiles.mockRejectedValue(new WorkspaceError('NOT_OPEN', '工作区未打开', false))

      const result = await handlers['workspace:listFiles']({}, { subdir: 'root' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('NOT_OPEN')
    })
  })

  describe('v1.5.3 mutable workspaceRefs 注入', () => {
    test('替换 refs.inner 后下次调用使用新实例（无需 re-register）', async () => {
      const refs = {
        workspaceManager: mockManager,
        wikiEngine: null,
        kgExtractor: null
      }
      workspaceHandler.register(refs)

      // 第一次：用旧 mockManager
      mockManager.open.mockResolvedValue({ path: '/old' })
      const r1 = await handlers['workspace:open']({}, { path: '/old' })
      expect(r1).toEqual({ path: '/old' })

      // 替换：注入新实例
      const newManager = {
        open: jest.fn().mockResolvedValue({ path: '/new', status: 'ready' }),
        close: jest.fn(), current: jest.fn(), listFiles: jest.fn()
      }
      refs.workspaceManager = newManager

      // 第二次：自动用新实例（无 re-register）
      const r2 = await handlers['workspace:open']({}, { path: '/new' })
      expect(newManager.open).toHaveBeenCalledWith('/new')
      expect(r2).toEqual({ path: '/new', status: 'ready' })
    })
  })
})