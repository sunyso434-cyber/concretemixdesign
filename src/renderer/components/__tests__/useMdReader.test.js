/**
 * useMdReader 纯函数核心测试
 * 覆盖：normalizePath / dedupeOpen / applyFileChanged / resolveConflict / clampWidth
 *
 * 跑法：npx jest src/renderer/components/__tests__/useMdReader.test.js -v
 */

const {
  normalizePath,
  dedupeOpen,
  closeTab,
  applyReadSuccess,
  applyReadFailure,
  applyFileChanged,
  resolveConflict,
  applyWorkspaceChanged,
  clampWidth
} = require('../useMdReader.core.js')

describe('normalizePath', () => {
  test('Windows 大小写归一', () => {
    expect(normalizePath('C:\\Foo.md')).toBe(normalizePath('c:\\foo.md'))
  })
})

describe('dedupeOpen', () => {
  test('已存在 key 切到已有 tab，不新增', () => {
    // 夹具按 core 契约传 file.path；已打开 tab 的 key 为 normalizePath 后的路径，
    // 再次打开（大小写不同）应命中已有 tab 而非新增
    const s = { tabs: [{ key: 'c:/docs/a.md', path: 'C:\\docs\\a.md' }], activeKey: 'x' }
    const r = dedupeOpen(s, { path: 'c:\\docs\\a.md' })
    expect(r.tabs.length).toBe(1)
    expect(r.activeKey).toBe('c:/docs/a.md')
  })
  test('超 10 个拒绝新增', () => {
    const tabs = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, path: `/k${i}.md` }))
    const r = dedupeOpen({ tabs }, { key: 'new' })
    expect(r.rejected).toBe(true)
  })
})

describe('applyFileChanged', () => {
  const base = { contents: { a: '旧' }, drafts: {}, lastSeen: { a: { mtimeMs: 1, size: 2 } } }
  test('预览态 → 需静默刷新（返回 reloadKey）', () => {
    const s = { ...base, tabs: [{ key: 'a', mode: 'preview', dirty: false, conflict: null }], activeKey: 'a' }
    const r = applyFileChanged(s, 'a', { mtimeMs: 5, size: 9 })
    expect(r.reloadKey).toBe('a')
    expect(r.conflict).toBeUndefined()
  })
  test('编辑态有 dirty → 弹冲突（conflict=external-change）', () => {
    const s = { ...base, tabs: [{ key: 'a', mode: 'edit', dirty: true, conflict: null }], activeKey: 'a' }
    const r = applyFileChanged(s, 'a', { mtimeMs: 5, size: 9 })
    expect(r.tabs[0].conflict).toBe('external-change')
  })
  test('编辑态无 dirty → 非阻塞提示（noticeKey，不自动刷新）', () => {
    const s = { ...base, tabs: [{ key: 'a', mode: 'edit', dirty: false, conflict: null }], activeKey: 'a' }
    const r = applyFileChanged(s, 'a', { mtimeMs: 5, size: 9 })
    expect(r.noticeKey).toBe('a')
    expect(r.reloadKey).toBeUndefined()
  })
  test('无变化（等于 lastSeen）→ 忽略（自身写）', () => {
    const s = { ...base, tabs: [{ key: 'a', mode: 'preview', dirty: false, conflict: null }], activeKey: 'a' }
    const r = applyFileChanged(s, 'a', { mtimeMs: 1, size: 2 })
    expect(r.reloadKey).toBeUndefined()
    expect(r.conflict).toBeUndefined()
  })
})

describe('resolveConflict', () => {
  test('reload 丢弃草稿清 conflict', () => {
    // core 的 reload 分支读 state.contents[key]，夹具需带上 contents/drafts（hook 真实 state 恒有）
    const r = resolveConflict({ contents: { a: '旧' }, drafts: {}, tabs: [{ key: 'a', dirty: true, conflict: 'external-change' }] }, 'a', 'reload')
    expect(r.tabs[0].conflict).toBeNull()
    expect(r.tabs[0].dirty).toBe(false)
    expect(r.reloadKey).toBe('a')
  })
  test('keep 保留草稿，仅清 conflict', () => {
    const r = resolveConflict({ tabs: [{ key: 'a', dirty: true, conflict: 'external-change' }] }, 'a', 'keep')
    expect(r.tabs[0].conflict).toBeNull()
    expect(r.tabs[0].dirty).toBe(true)
  })
})

describe('clampWidth', () => {
  test('下限 280 / 上限 min(600, innerWidth*0.6)', () => {
    expect(clampWidth(100, 1400)).toBe(280)
    expect(clampWidth(800, 1400)).toBe(600)
    expect(clampWidth(500, 800)).toBe(480) // 800*0.6=480
  })
})
