const { ChatHistorySync } = require('../../workspace/ChatHistorySync')

describe('ChatHistorySync', () => {
  let mgr
  let mockExporter
  let sync

  beforeEach(() => {
    mgr = { current: jest.fn() }
    mockExporter = {
      formatMD: jest.fn(),
      formatJSONL: jest.fn(),
      parseJSONL: jest.fn()
    }
    sync = new ChatHistorySync({ workspace: mgr, exporter: mockExporter })
  })

  // P2b 核心：markPending 加入 pendingQueue（Set 去重）
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

  test('exportAllPending 是 async 方法（stub）', () => {
    expect(sync.exportAllPending).toBeDefined()
    const result = sync.exportAllPending()
    expect(result).toBeInstanceOf(Promise)
  })

  test('flushPendingExports 是 async 方法（stub）', () => {
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
