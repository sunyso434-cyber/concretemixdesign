// src/main/agent/__tests__/ToolResultStore.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const ToolResultStore = require('../ToolResultStore')

describe('ToolResultStore', () => {
  const testDir = path.join(os.tmpdir(), 'tool-cache-test-' + Date.now())
  const store = new ToolResultStore({ cacheDir: testDir })
  const sessionId = 'test-session'
  const toolCallId = 'call_abc123'

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  test('store: 小结果 (< 20K) 不离盘，返回 offloaded=false', () => {
    const smallResult = { success: true, data: 'hello' }
    const result = store.store(sessionId, toolCallId, smallResult)
    expect(result.offloaded).toBe(false)
    // 磁盘不应有缓存文件
    const cachePath = path.join(testDir, sessionId, toolCallId + '.json')
    expect(fs.existsSync(cachePath)).toBe(false)
  })

  test('store: 大结果 (> 20K) 落盘，返回 offloaded=true + summary', () => {
    const largeResult = { success: true, data: 'x'.repeat(25000) }
    const result = store.store(sessionId, 'call_big', largeResult)
    expect(result.offloaded).toBe(true)
    expect(result.path).toContain('call_big.json')
    expect(result.summary).toBeDefined()
    expect(result.summary.length).toBeLessThanOrEqual(500)
    // 磁盘应有缓存
    expect(fs.existsSync(result.path)).toBe(true)
  })

  test('store: 超大结果 (> 200K) 落盘 + 缓存也摘要', () => {
    const hugeResult = { success: true, data: 'x'.repeat(250000) }
    const result = store.store(sessionId, 'call_huge', hugeResult)
    expect(result.offloaded).toBe(true)
    // get() 应该返回摘要版本
    const cached = store.get('call_huge')
    expect(cached._summarized).toBe(true)
  })

  test('getRecentKeys: 返回最近 3 条', () => {
    const st = new ToolResultStore({ cacheDir: path.join(os.tmpdir(), 'tool-cache-test2-' + Date.now()) })
    // 用小结果（不离盘），连续存 5 次
    for (let i = 0; i < 5; i++) {
      st.store('session-recent', `call_${i}`, { data: `result_${i}` })
    }
    const keys = st.getRecentKeys('session-recent')
    expect(keys.length).toBe(3)
    // 最近的 3 条应该是 call_2, call_3, call_4
    expect(keys[0].toolCallId).toBe('call_2')
    expect(keys[2].toolCallId).toBe('call_4')
  })

  test('get: 从磁盘读取缓存结果', () => {
    const dir = path.join(os.tmpdir(), 'tool-cache-test3-' + Date.now())
    const st = new ToolResultStore({ cacheDir: dir })
    const bigResult = { success: true, data: 'x'.repeat(25000) }
    const result = st.store('s', 'call_get', bigResult)
    expect(result.offloaded).toBe(true)

    // 从磁盘读
    const cached = st.get('call_get')
    expect(cached).toEqual(bigResult)
  })

  test('clear: 清理会话目录和内存缓存', () => {
    const dir = path.join(os.tmpdir(), 'tool-cache-test4-' + Date.now())
    const st = new ToolResultStore({ cacheDir: dir })
    st.store('s1', 'c1', { data: 'x'.repeat(25000) })
    st.store('s2', 'c2', { data: 'x'.repeat(25000) })
    st.clear('s1')
    // 磁盘清理
    const sessionDir = path.join(dir, 's1')
    expect(fs.existsSync(sessionDir)).toBe(false)
    // s2 不受影响
    expect(fs.existsSync(path.join(dir, 's2'))).toBe(true)
    // 内存缓存清理
    expect(st.get('c1')).toBeNull()
    expect(st.get('c2')).toBeDefined()
  })

  test('clearExpired: 清理过期缓存（内存 + 磁盘）', () => {
    const dir = path.join(os.tmpdir(), 'tool-cache-test5-' + Date.now())
    const st = new ToolResultStore({ cacheDir: dir })
    const now = Date.now()

    // c_old 用小结果（不离盘，只测内存缓存清理）
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now - 3600000)
    st.store('s_exp', 'c_old', { data: 'old' })
    spy.mockRestore()

    // c_old_big 用大结果（离盘），写入后用 fs.utimesSync 把 mtime 改到 1 小时前
    st.store('s_exp', 'c_old_big', { data: 'x'.repeat(25000) })
    const oldFilePath = path.join(dir, 's_exp', 'c_old_big.json')
    fs.utimesSync(oldFilePath, new Date(now - 3600000), new Date(now - 3600000))

    // c_fresh 用当前时间
    st.store('s_exp', 'c_fresh', { data: 'y'.repeat(25000) })

    // 清理 5 分钟过期的
    st.clearExpired(5 * 60 * 1000)

    // 内存缓存：c_old 过期被删，c_fresh 还在
    expect(st.get('c_old')).toBeNull()
    expect(st.get('c_fresh')).toBeDefined()

    // 磁盘文件：c_old_big 过期被删，c_fresh 文件还在
    expect(fs.existsSync(oldFilePath)).toBe(false)
    expect(fs.existsSync(path.join(dir, 's_exp', 'c_fresh.json'))).toBe(true)
  })
})
