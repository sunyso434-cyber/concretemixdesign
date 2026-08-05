/**
 * @jest-environment jsdom
 *
 * useMdReader 测试
 * 1) 纯函数核心：normalizePath / dedupeOpen / applyFileChanged / resolveConflict / clampWidth
 * 2) hook 状态机闭合（mock window.electronAPI.md.*）：重开不丢草稿 / 保存清 conflict / 读失败解锁 inflight
 *
 * 跑法：npx jest src/renderer/components/__tests__/useMdReader.test.js --verbose
 */
import { renderHook, act } from '@testing-library/react'

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
const { useMdReader } = require('../useMdReader.js')

// --- Mock window.electronAPI.md.*（hook 消费侧） ---
const mdMock = {
  read: jest.fn(),
  write: jest.fn(),
  watch: jest.fn(),
  unwatch: jest.fn(),
  onFileChanged: jest.fn(() => 1),
  removeFileChangedListener: jest.fn()
}
global.window = global.window || {}
global.window.electronAPI = { md: mdMock }

beforeEach(() => {
  jest.useFakeTimers()
  localStorage.clear()
  mdMock.read.mockReset()
  mdMock.write.mockReset()
  mdMock.watch.mockReset()
  mdMock.unwatch.mockReset()
  mdMock.onFileChanged.mockReset().mockReturnValue(1)
  mdMock.removeFileChangedListener.mockReset()
})
afterEach(() => {
  jest.useRealTimers()
})

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

// ============ hook 状态机闭合（审查修复） ============

describe('useMdReader hook：重开已打开 tab', () => {
  test('命中已打开健康 tab → 不重读不重复 watch，草稿与 dirty 保留', async () => {
    mdMock.read.mockResolvedValue({ content: '磁盘正文', body: '磁盘正文', mtimeMs: 1, size: 2 })
    const { result } = renderHook(() => useMdReader())

    await act(async () => { await result.current.openFile('C:\\docs\\a.md') })
    act(() => result.current.toggleEdit('c:/docs/a.md'))
    act(() => result.current.setDraft('c:/docs/a.md', '未保存的草稿'))

    expect(result.current.state.drafts['c:/docs/a.md']).toBe('未保存的草稿')
    expect(result.current.state.tabs[0].dirty).toBe(true)
    expect(mdMock.read).toHaveBeenCalledTimes(1)

    // 用不同大小写重新打开同一文件：命中已有 tab → 不重读，草稿不被磁盘内容覆盖
    await act(async () => { await result.current.openFile('c:\\docs\\a.md') })

    expect(mdMock.read).toHaveBeenCalledTimes(1)
    expect(mdMock.watch).toHaveBeenCalledTimes(1)
    expect(result.current.state.drafts['c:/docs/a.md']).toBe('未保存的草稿')
    expect(result.current.state.tabs[0].dirty).toBe(true)
    expect(result.current.state.tabs.length).toBe(1)
    expect(result.current.state.activeKey).toBe('c:/docs/a.md')
  })
})

describe('useMdReader hook：保存成功清 conflict', () => {
  test('save-failed 后 retry 保存成功 → conflict 清空、dirty 置 false', async () => {
    mdMock.read.mockResolvedValue({ content: '内容', body: '内容', mtimeMs: 1, size: 2 })
    const { result } = renderHook(() => useMdReader())

    await act(async () => { await result.current.openFile('C:\\docs\\a.md') })
    act(() => result.current.toggleEdit('c:/docs/a.md'))
    act(() => result.current.setDraft('c:/docs/a.md', '未保存草稿'))
    expect(result.current.state.tabs[0].dirty).toBe(true)

    // 首次保存失败（debounce 触发）→ conflict='save-failed'
    mdMock.write.mockResolvedValueOnce({ error: '磁盘写入失败' })
    await act(async () => { jest.advanceTimersByTime(800) })
    expect(mdMock.write).toHaveBeenCalledTimes(1)
    expect(result.current.state.tabs[0].conflict).toBe('save-failed')

    // retry 保存成功 → conflict 与 dirty 均被清除（修复：成功分支置 conflict:null）
    mdMock.write.mockResolvedValue({ ok: true, mtimeMs: 2, size: 3, body: '未保存草稿' })
    act(() => result.current.resolveConflict('c:/docs/a.md', 'retry'))
    await act(async () => {})
    expect(result.current.state.tabs[0].conflict).toBeNull()
    expect(result.current.state.tabs[0].dirty).toBe(false)
  })
})

describe('useMdReader hook：读失败解锁 inflight', () => {
  test('读失败后同 key 可再次 openFile 重读重试', async () => {
    mdMock.read.mockResolvedValueOnce({ error: '文件不存在' })
    const { result } = renderHook(() => useMdReader())

    await act(async () => { await result.current.openFile('C:\\missing.md') })
    expect(result.current.state.tabs[0].status).toBe('error')
    expect(mdMock.read).toHaveBeenCalledTimes(1)

    // 读失败已解锁 inflight → 再次打开同一文件能重读重试（error 态 tab 不命中"健康早退"）
    mdMock.read.mockResolvedValue({ content: '正文', body: '正文', mtimeMs: 1, size: 2 })
    await act(async () => { await result.current.openFile('c:\\missing.md') })

    expect(mdMock.read).toHaveBeenCalledTimes(2)
    expect(result.current.state.tabs[0].status).toBe('done')
    expect(result.current.state.tabs[0].conflict).toBeNull()
  })
})
