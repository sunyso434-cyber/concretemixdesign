'use strict'

// lastWorkspaceStore 测试（R8 单 path → 最近 N 列表）：
//   - get() 兼容：仍返回最近一个 path（旧调用方不感知新格式）
//   - set(p)：插入最近列表最前，去重（重复 open 同路径置顶 + 刷新 savedAt）
//   - 最近 N=20 上限：超出截断最旧
//   - 旧格式迁移：读 { path, savedAt } 幂等升级为 { recent: [{ path, savedAt }] }；
//     后续 set() 写新格式
//   - clear()：清空最近列表，get() 返回 null
//   - listRecent()：返回带 savedAt 的最近列表（新在前）

const fs = require('fs')
const os = require('os')
const path = require('path')

const store = require('../../workspace/lastWorkspaceStore')

describe('lastWorkspaceStore (R8 最近列表)', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-test-'))
    store.init(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('get(): 无文件 → null（兼容原行为）', () => {
    expect(store.get()).toBeNull()
  })

  test('set + get: get() 返回最近一个 path（兼容现有调用方）', () => {
    store.set('/a')
    store.set('/b')
    expect(store.get()).toBe('/b')
  })

  test('set: 去重，重复 open 同路径置顶并刷新 savedAt', () => {
    store.set('/a')
    store.set('/b')
    store.set('/a')
    const recent = store.listRecent()
    expect(recent.map(e => e.path)).toEqual(['/a', '/b'])
    expect(recent.length).toBe(2)
  })

  test('最近 N=20 上限：超出截断最旧', () => {
    for (let i = 0; i < 25; i++) store.set(`/ws-${i}`)
    const recent = store.listRecent()
    expect(recent.length).toBe(20)
    expect(recent[0].path).toBe('/ws-24')    // 最近在最前
    expect(recent[19].path).toBe('/ws-5')    // 保留的第 20 个（最旧）
    expect(recent.some(e => e.path === '/ws-4')).toBe(false)  // 更旧的被截断
  })

  test('旧格式迁移：读 { path, savedAt } → get() 返回该 path，listRecent 单元素', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'last-workspace.json'),
      JSON.stringify({ path: '/old', savedAt: '2026-01-01T00:00:00.000Z' }),
      'utf8'
    )

    expect(store.get()).toBe('/old')
    expect(store.listRecent()).toEqual([{ path: '/old', savedAt: '2026-01-01T00:00:00.000Z' }])
    // 幂等：反复读结果一致
    expect(store.get()).toBe('/old')
    expect(store.listRecent()).toEqual([{ path: '/old', savedAt: '2026-01-01T00:00:00.000Z' }])
  })

  test('旧格式迁移后 set() 写新格式（recent 数组）', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'last-workspace.json'),
      JSON.stringify({ path: '/old', savedAt: '2026-01-01T00:00:00.000Z' }),
      'utf8'
    )

    store.set('/new')
    const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, 'last-workspace.json'), 'utf8'))
    expect(Array.isArray(parsed.recent)).toBe(true)
    expect(parsed.recent.map(e => e.path)).toEqual(['/new', '/old'])
  })

  test('clear(): 清空最近列表，get() 返回 null', () => {
    store.set('/a')
    store.clear()
    expect(store.get()).toBeNull()
    expect(store.listRecent()).toEqual([])
  })

  test('listRecent(): 返回带 savedAt 的最近列表（新在前）', () => {
    store.set('/a')
    store.set('/b')
    const recent = store.listRecent()
    expect(recent.map(e => e.path)).toEqual(['/b', '/a'])
    expect(recent[0].savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
