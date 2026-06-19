/**
 * ChatHistorySync 测试（markPending + debounce + exportSession + exportAllPending）
 */

// Mock 数据库模块（exportSession / exportAllPending 依赖）
const mockChatHistory = { findAll: jest.fn() }
const mockChatSession = { findAll: jest.fn() }
jest.mock('../../db/database', () => ({
  ChatHistory: mockChatHistory,
  ChatSession: mockChatSession
}))

// Mock sequelize Op
jest.mock('sequelize', () => ({
  Op: { gt: Symbol('gt') }
}))

// Mock fs.promises
const mockFs = {
  mkdir: jest.fn(),
  stat: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  appendFile: jest.fn(),
  rename: jest.fn(),
  rm: jest.fn()
}
jest.mock('fs', () => ({
  promises: mockFs
}))

// Mock crypto.randomUUID
const mockRandomUUID = jest.fn()
jest.mock('crypto', () => ({
  randomUUID: mockRandomUUID
}))

const { ChatHistorySync } = require('../../workspace/ChatHistorySync')

describe('ChatHistorySync', () => {
  let mgr
  let mockExporter
  let sync

  beforeEach(() => {
    jest.clearAllMocks()
    mgr = { current: jest.fn() }
    mockExporter = {
      formatMD: jest.fn(),
      formatJSONL: jest.fn(),
      parseJSONL: jest.fn()
    }
    sync = new ChatHistorySync({ workspace: mgr, exporter: mockExporter })

    // 默认 mock 返回值
    mockRandomUUID.mockReturnValue('deadbeef-dead-beef-dead-beefdeadbeef')
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.appendFile.mockResolvedValue(undefined)
    mockFs.rename.mockResolvedValue(undefined)
    mockFs.rm.mockResolvedValue(undefined)
    mockExporter.formatJSONL.mockReturnValue('{"id":1}\n')
    mockExporter.formatMD.mockReturnValue('---\ntest: true\n---\n\n# MD')
    mockExporter.parseJSONL.mockReturnValue([{ id: 1 }])
    mockChatHistory.findAll.mockResolvedValue([])
    mockChatSession.findAll.mockResolvedValue([])
  })

  // ==================== P2b 核心：markPending ====================

  test('markPending 加入队列', () => {
    sync.markPending('sess-1')
    expect(sync.pendingQueue.has('sess-1')).toBe(true)
  })

  test('重复 markPending 去重', () => {
    sync.markPending('sess-1')
    sync.markPending('sess-1')
    expect(sync.pendingQueue.size).toBe(1)
  })

  test('markPending 启动 5 秒 debounce', () => {
    jest.useFakeTimers()
    const spy = jest.spyOn(sync, 'exportAllPending').mockResolvedValue({ exported: [], errors: [] })
    sync.markPending('sess-1')
    jest.advanceTimersByTime(5000)
    expect(spy).toHaveBeenCalled()
    jest.useRealTimers()
  })

  // 构造函数注入验证
  test('构造函数注入 workspace 和 exporter', () => {
    expect(sync.workspace).toBe(mgr)
    expect(sync.exporter).toBe(mockExporter)
  })

  test('debounce 延迟期间重复 markPending 只触发一次 exportAllPending', () => {
    jest.useFakeTimers()
    const spy = jest.spyOn(sync, 'exportAllPending').mockResolvedValue({ exported: [], errors: [] })

    sync.markPending('sess-1')
    jest.advanceTimersByTime(2000)
    sync.markPending('sess-2')
    jest.advanceTimersByTime(2000)
    sync.markPending('sess-3')
    // 每次 markPending 都重置 timer，所以只到 4000ms，还没触发
    expect(spy).not.toHaveBeenCalled()

    // 再推进 5 秒（从上一次 markPending 算起）
    jest.advanceTimersByTime(5000)
    expect(spy).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  test('pendingQueue 初始为空 Set', () => {
    expect(sync.pendingQueue).toBeInstanceOf(Set)
    expect(sync.pendingQueue.size).toBe(0)
  })

  test('DELAY_MS 默认值为 5000', () => {
    expect(sync.DELAY_MS).toBe(5000)
  })

  test('多次 markPending 后的 pendingQueue 包含所有不同 session', () => {
    sync.markPending('sess-1')
    sync.markPending('sess-2')
    sync.markPending('sess-3')
    expect(sync.pendingQueue.size).toBe(3)
    expect(sync.pendingQueue.has('sess-1')).toBe(true)
    expect(sync.pendingQueue.has('sess-2')).toBe(true)
    expect(sync.pendingQueue.has('sess-3')).toBe(true)
  })

  // ==================== exportSession ====================

  describe('exportSession', () => {
    const workspacePath = '/test/workspace'

    test('首次导出：无已有 JSONL，全量写文件', async () => {
      const messages = [
        { id: 1, role: 'user', content: 'hello', createdAt: '2025-01-01T00:00:00Z' },
        { id: 2, role: 'assistant', content: 'hi', createdAt: '2025-01-01T00:00:01Z' }
      ]
      mockChatHistory.findAll.mockResolvedValue(messages)
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))  // 首次导出

      const result = await sync.exportSession('sess-12345678', workspacePath)

      expect(result.status).toBe('ok')
      expect(result.messageCount).toBe(2)
      expect(result.isFullExport).toBe(true)
      expect(mockFs.mkdir).toHaveBeenCalled()
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2)  // JSONL + MD
      expect(mockFs.rename).toHaveBeenCalled()
      expect(mockExporter.formatJSONL).toHaveBeenCalledWith(messages)
      expect(mockExporter.formatMD).toHaveBeenCalledWith('sess-12345678', messages, workspacePath)
    })

    test('增量导出：已有 JSONL，仅追加新消息', async () => {
      const existingMessages = [
        { id: 1, role: 'user', content: 'first', createdAt: '2025-01-01T00:00:00Z' }
      ]
      const newMessages = [
        { id: 1, role: 'user', content: 'first', createdAt: '2025-01-01T00:00:00Z' },
        { id: 2, role: 'assistant', content: 'second', createdAt: '2025-01-01T00:00:01Z' }
      ]

      mockChatHistory.findAll.mockResolvedValue(newMessages)
      mockFs.stat.mockResolvedValue({ size: 100 })
      mockFs.readFile.mockResolvedValue('{"id":1,"role":"user"}\n')
      mockExporter.parseJSONL.mockReturnValue(existingMessages)
      mockExporter.formatJSONL
        .mockReturnValueOnce('{"id":1,"role":"user"}\n')  // 第一次调用（全量，实际是 formatJSONL(messages)）
        .mockReturnValueOnce('{"id":2,"role":"assistant"}\n')  // 第二次调用（增量）

      const result = await sync.exportSession('sess-12345678', workspacePath)

      expect(result.status).toBe('ok')
      expect(result.isFullExport).toBe(false)
      expect(result.messageCount).toBe(2)
      expect(mockFs.rename).toHaveBeenCalled()
    })

    test('增量导出时无新消息则不写 JSONL', async () => {
      const messages = [
        { id: 1, role: 'user', content: 'only', createdAt: '2025-01-01T00:00:00Z' }
      ]

      mockChatHistory.findAll.mockResolvedValue(messages)
      mockFs.stat.mockResolvedValue({ size: 100 })
      mockFs.readFile.mockResolvedValue('{"id":1,"role":"user"}\n')
      mockExporter.parseJSONL.mockReturnValue(messages)
      // existingLastId = 1，messages 全部 id <= 1，newMessages 为空

      const result = await sync.exportSession('sess-12345678', workspacePath)

      expect(result.status).toBe('ok')
      expect(result.messageCount).toBe(1)
      // MD 始终重写
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1)  // 只写 MD
    })

    test('导出失败时清理临时文件并抛出 WorkspaceError', async () => {
      mockChatHistory.findAll.mockResolvedValue([{ id: 1, role: 'user', content: 'x' }])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      mockFs.writeFile.mockRejectedValue(new Error('磁盘满'))

      await expect(sync.exportSession('sess-12345678', workspacePath))
        .rejects.toThrow('磁盘满')

      expect(mockFs.rm).toHaveBeenCalled()  // 清理 tmp 文件
    })

    test('空消息数组也正常导出', async () => {
      mockChatHistory.findAll.mockResolvedValue([])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))

      const result = await sync.exportSession('sess-12345678', workspacePath)

      expect(result.status).toBe('ok')
      expect(result.messageCount).toBe(0)
      expect(mockExporter.formatJSONL).toHaveBeenCalledWith([])
    })

    test('目录自动创建', async () => {
      mockChatHistory.findAll.mockResolvedValue([])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))

      await sync.exportSession('sess-12345678', workspacePath)

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('wiki'),
        { recursive: true }
      )
    })

    test('临时文件使用 UUID 命名避免冲突', async () => {
      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))

      await sync.exportSession('sess-12345678', workspacePath)

      expect(mockRandomUUID).toHaveBeenCalled()
    })
  })

  // ==================== exportAllPending ====================

  describe('exportAllPending', () => {
    test('workspace 未打开时返回空结果', async () => {
      mgr.current.mockReturnValue(null)

      const result = await sync.exportAllPending()

      expect(result).toEqual({ exported: [], errors: [] })
    })

    test('pendingQueue 为空时返回空结果', async () => {
      mgr.current.mockReturnValue({ path: '/test/ws' })
      mockChatSession.findAll.mockResolvedValue([])

      const result = await sync.exportAllPending()

      expect(result.exported).toEqual([])
      expect(result.errors).toEqual([])
    })

    test('导出 pendingQueue 中所有 session', async () => {
      mgr.current.mockReturnValue({ path: '/test/ws' })
      sync.pendingQueue.add('sess-1')
      sync.pendingQueue.add('sess-2')
      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      mockChatSession.findAll.mockResolvedValue([])

      const result = await sync.exportAllPending()

      expect(result.exported).toEqual(['sess-1', 'sess-2'])
      expect(result.errors).toEqual([])
      expect(sync.pendingQueue.size).toBe(0)  // 清空了
    })

    test('某个 session 导出失败不影响其他', async () => {
      mgr.current.mockReturnValue({ path: '/test/ws' })
      sync.pendingQueue.add('sess-ok')
      sync.pendingQueue.add('sess-fail')

      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      // exportSession 每次调 writeFile 两次（JSONL + MD）
      // sess-ok: JSONL resolve + MD resolve = 2 次成功
      // sess-fail: JSONL reject → 进 catch
      mockFs.writeFile
        .mockResolvedValueOnce(undefined)  // sess-ok JSONL 成功
        .mockResolvedValueOnce(undefined)  // sess-ok MD 成功
        .mockRejectedValueOnce(new Error('磁盘满'))  // sess-fail JSONL 失败

      mockChatSession.findAll.mockResolvedValue([])

      const result = await sync.exportAllPending()

      expect(result.exported).toEqual(['sess-ok'])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].sessionId).toBe('sess-fail')
    })

    test('兜底查询 ChatSession 最近 60s 活跃', async () => {
      mgr.current.mockReturnValue({ path: '/test/ws' })
      sync.pendingQueue.add('sess-1')
      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      mockChatSession.findAll.mockResolvedValue([
        { sessionId: 'sess-1' },
        { sessionId: 'sess-fallback' }
      ])

      const result = await sync.exportAllPending()

      expect(result.exported).toContain('sess-1')
      expect(result.exported).toContain('sess-fallback')
    })

    test('兜底查询 ChatSession 不重复导出已在 pendingQueue 中的', async () => {
      mgr.current.mockReturnValue({ path: '/test/ws' })
      sync.pendingQueue.add('sess-1')
      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      mockChatSession.findAll.mockResolvedValue([
        { sessionId: 'sess-1' },
        { sessionId: 'sess-2' }
      ])

      const result = await sync.exportAllPending()

      // sess-1 from pendingQueue, sess-2 from fallback
      expect(result.exported).toEqual(['sess-1', 'sess-2'])
      // mockChatHistory.findAll 被调用了 2 次（sess-1 + sess-2）
      expect(mockChatHistory.findAll).toHaveBeenCalledTimes(2)
    })

    test('ChatSession 查询失败时不影响 pendingQueue 导出', async () => {
      mgr.current.mockReturnValue({ path: '/test/ws' })
      sync.pendingQueue.add('sess-1')
      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      mockChatSession.findAll.mockRejectedValue(new Error('table not found'))

      const result = await sync.exportAllPending()

      expect(result.exported).toEqual(['sess-1'])
      expect(result.errors).toEqual([])
    })
  })

  // ==================== flushPendingExports ====================

  describe('flushPendingExports', () => {
    test('清除 debounce timer 并直接调用 exportAllPending', async () => {
      jest.useFakeTimers()
      const exportSpy = jest.spyOn(sync, 'exportAllPending')
      // 允许 exportAllPending 实际执行
      exportSpy.mockRestore()

      mgr.current.mockReturnValue({ path: '/test/ws' })

      // 先 schedule：markPending 会设置 debounceTimer
      sync.markPending('sess-1')
      expect(sync.debounceTimer).not.toBeNull()

      mockChatHistory.findAll.mockResolvedValue([
        { id: 1, role: 'user', content: 'x', createdAt: '2025-01-01T00:00:00Z' }
      ])
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))
      mockChatSession.findAll.mockResolvedValue([])

      const result = await sync.flushPendingExports()

      expect(result.exported).toEqual(['sess-1'])
      // 验证 debounce timer 已被取消：推进 5s 不会再次触发
      // 重新 spy 来验证
      const spy2 = jest.spyOn(sync, 'exportAllPending').mockResolvedValue({ exported: [], errors: [] })
      jest.advanceTimersByTime(5000)
      expect(spy2).not.toHaveBeenCalled()  // debounce 已取消

      jest.useRealTimers()
    })
  })

  // ==================== 已有 stub 验证 ====================

  test('exportAllPending 是 async 方法', () => {
    expect(sync.exportAllPending).toBeDefined()
    const result = sync.exportAllPending()
    expect(result).toBeInstanceOf(Promise)
  })

  test('flushPendingExports 是 async 方法', () => {
    expect(sync.flushPendingExports).toBeDefined()
    const result = sync.flushPendingExports()
    expect(result).toBeInstanceOf(Promise)
  })

  test('listSessions 是 async 方法（stub）', () => {
    expect(sync.listSessions).toBeDefined()
    const result = sync.listSessions('/test')
    expect(result).toBeInstanceOf(Promise)
  })

  test('loadSession 是 async 方法（stub）', () => {
    expect(sync.loadSession).toBeDefined()
    const result = sync.loadSession('sid', '/test')
    expect(result).toBeInstanceOf(Promise)
  })

  test('migrateSession 是 async 方法（stub）', () => {
    expect(sync.migrateSession).toBeDefined()
    const result = sync.migrateSession('sid', '/from', '/to')
    expect(result).toBeInstanceOf(Promise)
  })
})
