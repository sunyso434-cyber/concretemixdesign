/**
 * ChatHistorySync 测试（markPending + debounce + exportSession + exportAllPending）
 */

// Mock 数据库模块（exportSession / exportAllPending 依赖）
const mockChatHistory = { findAll: jest.fn(), update: jest.fn() }
const mockChatSession = { findAll: jest.fn(), update: jest.fn() }
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
      parseJSONL: jest.fn(),
      loadSession: jest.fn()
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

  // ==================== listSessions（双源合并）====================

  describe('listSessions', () => {
    const workspacePath = '/test/workspace'

    beforeEach(() => {
      mockFs.readdir = jest.fn().mockResolvedValue([])
      mockChatSession.findAll.mockResolvedValue([])
    })

    test('无文件系统目录且无 SQLite 数据时返回空数组', async () => {
      const sessions = await sync.listSessions(workspacePath)
      expect(sessions).toEqual([])
    })

    test('从文件系统读取 session（扫描 chat-history 子目录）', async () => {
      mockFs.readdir.mockResolvedValue(['abc12345', 'def67890'])
      mockFs.readFile
        .mockResolvedValueOnce([
          '---',
          'sessionId: sess-abc',
          'title: Test Session ABC',
          'workspacePath: /test/workspace',
          'messageCount: 10',
          'firstActivity: "2025-01-01T00:00:00Z"',
          'lastActivity: "2025-01-01T01:00:00Z"',
          'exportedAt: "2025-01-01T01:00:01Z"',
          '---'
        ].join('\n'))
        .mockResolvedValueOnce([
          '---',
          'sessionId: sess-def',
          'title: Test Session DEF',
          'workspacePath: /test/workspace',
          'messageCount: 5',
          'firstActivity: "2025-01-02T00:00:00Z"',
          'lastActivity: "2025-01-02T00:30:00Z"',
          'exportedAt: "2025-01-02T00:30:01Z"',
          '---'
        ].join('\n'))

      const sessions = await sync.listSessions(workspacePath)

      expect(sessions).toHaveLength(2)
      expect(sessions[0].sessionId).toBe('sess-abc')
      expect(sessions[0].source).toBe('file')
      expect(sessions[0].pending).toBe(false)
      expect(sessions[1].sessionId).toBe('sess-def')
      expect(sessions[1].source).toBe('file')
      expect(sessions[1].pending).toBe(false)
    })

    test('按 workspacePath 严格隔离，过滤不匹配的 session', async () => {
      mockFs.readdir.mockResolvedValue(['abc12345'])
      mockFs.readFile.mockResolvedValueOnce([
        '---',
        'sessionId: sess-other',
        'title: Other Workspace',
        'workspacePath: /other/workspace',
        'messageCount: 1',
        'firstActivity: "2025-01-01T00:00:00Z"',
        'lastActivity: "2025-01-01T00:00:00Z"',
        'exportedAt: "2025-01-01T00:00:01Z"',
        '---'
      ].join('\n'))

      const sessions = await sync.listSessions(workspacePath)
      expect(sessions).toEqual([])
    })

    test('workspacePath 归一化比较（反斜杠 vs 正斜杠）', async () => {
      mockFs.readdir.mockResolvedValue(['abc12345'])
      mockFs.readFile.mockResolvedValueOnce([
        '---',
        'sessionId: sess-match',
        'title: Match',
        'workspacePath: C:/Users/test/workspace',
        'messageCount: 1',
        'firstActivity: "2025-01-01T00:00:00Z"',
        'lastActivity: "2025-01-01T00:00:00Z"',
        'exportedAt: "2025-01-01T00:00:01Z"',
        '---'
      ].join('\n'))

      const sessions = await sync.listSessions('C:\\Users\\test\\workspace')
      expect(sessions).toHaveLength(1)
      expect(sessions[0].sessionId).toBe('sess-match')
    })

    test('SQLite 最近 60s 活跃 session 合并到结果（pending: true）', async () => {
      mockFs.readdir.mockResolvedValue(['abc12345'])
      mockFs.readFile.mockResolvedValueOnce([
        '---',
        'sessionId: sess-file',
        'title: File Session',
        'workspacePath: /test/workspace',
        'messageCount: 3',
        'firstActivity: "2025-01-01T00:00:00Z"',
        'lastActivity: "2025-01-01T00:00:30Z"',
        'exportedAt: "2025-01-01T00:00:31Z"',
        '---'
      ].join('\n'))

      mockChatSession.findAll.mockResolvedValue([
        { sessionId: 'sess-file', sessionName: 'File Session', createdAt: new Date(), lastActivity: new Date() },
        { sessionId: 'sess-db-only', sessionName: 'DB Only', createdAt: new Date(), lastActivity: new Date() }
      ])

      const sessions = await sync.listSessions(workspacePath)

      expect(sessions).toHaveLength(2)

      const fileSession = sessions.find(s => s.sessionId === 'sess-file')
      expect(fileSession.source).toBe('file')
      expect(fileSession.pending).toBe(false)

      const dbSession = sessions.find(s => s.sessionId === 'sess-db-only')
      expect(dbSession.source).toBe('sqlite')
      expect(dbSession.pending).toBe(true)
      expect(dbSession.sessionId).toBe('sess-db-only')
    })

    test('readdir 抛出异常时回退到空列表（不影响 SQLite 查询）', async () => {
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'))
      mockChatSession.findAll.mockResolvedValue([
        { sessionId: 'sess-db', sessionName: 'DB Session', createdAt: new Date(), lastActivity: new Date() }
      ])

      const sessions = await sync.listSessions(workspacePath)

      expect(sessions).toHaveLength(1)
      expect(sessions[0].sessionId).toBe('sess-db')
      expect(sessions[0].source).toBe('sqlite')
    })

    test('单个 session.md 损坏不影响其他正常 session', async () => {
      mockFs.readdir.mockResolvedValue(['ok-dir', 'bad-dir'])
      mockFs.readFile
        .mockResolvedValueOnce([
          '---',
          'sessionId: sess-ok',
          'title: OK',
          'workspacePath: /test/workspace',
          'messageCount: 1',
          'firstActivity: "2025-01-01T00:00:00Z"',
          'lastActivity: "2025-01-01T00:00:00Z"',
          'exportedAt: "2025-01-01T00:00:01Z"',
          '---'
        ].join('\n'))
        .mockRejectedValueOnce(new Error('EPERM'))

      const sessions = await sync.listSessions(workspacePath)

      expect(sessions).toHaveLength(1)
      expect(sessions[0].sessionId).toBe('sess-ok')
    })

    test('ChatSession.findAll 失败时不影响文件系统结果', async () => {
      mockFs.readdir.mockResolvedValue(['abc12345'])
      mockFs.readFile.mockResolvedValueOnce([
        '---',
        'sessionId: sess-file',
        'title: File',
        'workspacePath: /test/workspace',
        'messageCount: 1',
        'firstActivity: "2025-01-01T00:00:00Z"',
        'lastActivity: "2025-01-01T00:00:00Z"',
        'exportedAt: "2025-01-01T00:00:01Z"',
        '---'
      ].join('\n'))
      mockChatSession.findAll.mockRejectedValue(new Error('table not found'))

      const sessions = await sync.listSessions(workspacePath)

      expect(sessions).toHaveLength(1)
      expect(sessions[0].sessionId).toBe('sess-file')
    })

    test('workspacePath 为 null 的 frontmatter 不过滤（兼容旧数据）', async () => {
      mockFs.readdir.mockResolvedValue(['abc12345'])
      mockFs.readFile.mockResolvedValueOnce([
        '---',
        'sessionId: sess-legacy',
        'title: Legacy',
        'workspacePath:',
        'messageCount: 1',
        'firstActivity: "2025-01-01T00:00:00Z"',
        'lastActivity: "2025-01-01T00:00:00Z"',
        'exportedAt: "2025-01-01T00:00:01Z"',
        '---'
      ].join('\n'))

      const sessions = await sync.listSessions(workspacePath)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].sessionId).toBe('sess-legacy')
    })
  })

  // ==================== migrateSession (Task 2.15) ====================

  describe('migrateSession', () => {
    const fromWs = '/old/workspace'
    const toWs = '/new/workspace'

    beforeEach(() => {
      mockChatHistory.update.mockResolvedValue([1])
      mockChatSession.update.mockResolvedValue([1])
      // fs.stat: 存在旧文件
      mockFs.stat.mockResolvedValue({ size: 100 })
      mockFs.readFile.mockResolvedValue([
        '---',
        'sessionId: sess-mig',
        'workspacePath: /old/workspace',
        '---',
        '# Hello'
      ].join('\n'))
      mockFs.writeFile.mockResolvedValue(undefined)
      // Reset markPending spy
      jest.spyOn(sync, 'markPending')
    })

    test('更新 SQLite 中 ChatHistory 和 ChatSession 的 workspacePath', async () => {
      await sync.migrateSession('sess-mig', fromWs, toWs)

      expect(mockChatHistory.update).toHaveBeenCalledWith(
        { workspacePath: toWs },
        { where: { sessionId: 'sess-mig' } }
      )
      expect(mockChatSession.update).toHaveBeenCalledWith(
        { workspacePath: toWs },
        { where: { sessionId: 'sess-mig' } }
      )
    })

    test('旧文件存在时读取并写入 supersededBy 信息', async () => {
      await sync.migrateSession('sess-mig', fromWs, toWs)

      // 检查旧文件被读取
      const slug = 'sess-mig'.substring(0, 8)
      expect(mockFs.readFile).toHaveBeenCalledWith(
        expect.stringContaining(slug),
        'utf-8'
      )
      // 检查旧文件被重写
      expect(mockFs.writeFile).toHaveBeenCalled()
    })

    test('旧文件不存在时只更新 DB，不报错', async () => {
      mockFs.stat.mockRejectedValue(new Error('ENOENT'))

      await expect(sync.migrateSession('sess-mig', fromWs, toWs)).resolves.toEqual({ updated: true })

      expect(mockChatHistory.update).toHaveBeenCalled()
      expect(mockChatSession.update).toHaveBeenCalled()
      expect(mockFs.readFile).not.toHaveBeenCalled()
    })

    test('迁移后调 markPending 触发重新导出', async () => {
      await sync.migrateSession('sess-mig', fromWs, toWs)

      expect(sync.markPending).toHaveBeenCalledWith('sess-mig')
    })

    test('返回 { updated: true }', async () => {
      const result = await sync.migrateSession('sess-mig', fromWs, toWs)

      expect(result).toEqual({ updated: true })
    })

    test('ChatHistory.update 失败时抛错（不回滚文件操作）', async () => {
      mockChatHistory.update.mockRejectedValue(new Error('DB locked'))

      await expect(sync.migrateSession('sess-mig', fromWs, toWs)).rejects.toThrow('DB locked')
    })

    test('文件读取失败时继续执行（不阻塞 markPending）', async () => {
      mockFs.readFile.mockRejectedValue(new Error('EPERM'))

      const result = await sync.migrateSession('sess-mig', fromWs, toWs)

      expect(result).toEqual({ updated: true })
      expect(sync.markPending).toHaveBeenCalledWith('sess-mig')
    })
  })

  // ==================== onWorkspaceChange (Task 2.15) ====================

  describe('onWorkspaceChange', () => {
    let flushSpy
    let scheduleSpy

    beforeEach(() => {
      flushSpy = jest.spyOn(sync, 'flushPendingExports').mockResolvedValue({ exported: [], errors: [] })
      scheduleSpy = jest.spyOn(sync, 'scheduleExport').mockImplementation(() => {})
    })

    test('from=null, to=path: 只调 scheduleExport', async () => {
      await sync.onWorkspaceChange(null, '/new/ws')

      expect(flushSpy).not.toHaveBeenCalled()
      expect(scheduleSpy).toHaveBeenCalledTimes(1)
      expect(sync.pendingQueue.size).toBe(0)
    })

    test('from=path, to=null: flushPendingExports + clear queue', async () => {
      sync.pendingQueue.add('sess-1')
      sync.pendingQueue.add('sess-2')

      await sync.onWorkspaceChange('/old/ws', null)

      expect(flushSpy).toHaveBeenCalledTimes(1)
      expect(scheduleSpy).not.toHaveBeenCalled()
      expect(sync.pendingQueue.size).toBe(0)
    })

    test('from=path, to=path: flush + clear + scheduleExport', async () => {
      sync.pendingQueue.add('sess-1')

      await sync.onWorkspaceChange('/old/ws', '/new/ws')

      expect(flushSpy).toHaveBeenCalledTimes(1)
      expect(scheduleSpy).toHaveBeenCalledTimes(1)
      expect(sync.pendingQueue.size).toBe(0)
    })

    test('from=null, to=null: 无操作', async () => {
      await sync.onWorkspaceChange(null, null)

      expect(flushSpy).not.toHaveBeenCalled()
      expect(scheduleSpy).not.toHaveBeenCalled()
    })

    test('flushPendingExports 失败不影响队列清空', async () => {
      flushSpy.mockRejectedValue(new Error('flush failed'))
      sync.pendingQueue.add('sess-1')

      await expect(sync.onWorkspaceChange('/old/ws', null)).resolves.toBeUndefined()

      // 队列仍被清空
      expect(sync.pendingQueue.size).toBe(0)
    })
  })

  // ==================== loadSession ====================

  describe('loadSession', () => {
    test('委托给 this.exporter.loadSession', async () => {
      const expected = {
        messages: [{ id: 1, role: 'user', content: 'hi' }],
        renderedMd: '---\nsessionId: test\n---\n\n# MD',
        summary: { sessionId: 'test', messageCount: 1 }
      }
      mockExporter.loadSession = jest.fn().mockResolvedValue(expected)

      const result = await sync.loadSession('test-session-id', '/test/ws')
      expect(mockExporter.loadSession).toHaveBeenCalledWith('test-session-id', '/test/ws')
      expect(result).toBe(expected)
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
