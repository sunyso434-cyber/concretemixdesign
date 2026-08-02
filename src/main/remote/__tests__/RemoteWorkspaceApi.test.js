'use strict'

// RemoteWorkspaceApi 测试（R8）：
//   - 3 个通道：workspace:listRecent / open / current
//   - listRecent：复用 lastWorkspaceStore.listRecent，标注当前工作区 isCurrent
//   - open：调 workspaceManager.open(path)；成功后 fanout.send('workspace:changed', { path }) 广播
//     + lastWorkspaceStore.set(path) 更新最近列表（幂等去重）；失败不广播
//   - current：返回 workspaceManager.current() 的 path
//   - 响应约定与 R6 一致：同通道回 { requestId, success, ... }；requestId 缺省自动生成
//   - workspaceManager 走构造注入（与 RemoteAgentBridge 同款）；未注入且无 global 单例时
//     open 回 WORKSPACE_MANAGER_NOT_AVAILABLE
// ws 用 { send: jest.fn() } 替身。

jest.mock('../../workspace/lastWorkspaceStore', () => ({
  listRecent: jest.fn(),
  set: jest.fn()
}))

const lastWorkspaceStore = require('../../workspace/lastWorkspaceStore')
const RemoteWorkspaceApi = require('../RemoteWorkspaceApi')

function createWs() {
  return { send: jest.fn() }
}
function createFanout() {
  return { send: jest.fn() }
}
function createManager(overrides = {}) {
  return {
    open: jest.fn(),
    current: jest.fn(),
    ...overrides
  }
}

describe('RemoteWorkspaceApi', () => {
  let api
  let ws
  let fanout
  let manager

  beforeEach(() => {
    lastWorkspaceStore.listRecent.mockReset()
    lastWorkspaceStore.set.mockReset()
    // 不依赖 global.workspaceManager（避免跨文件污染），只走构造注入
    delete global.workspaceManager
    manager = createManager()
    api = new RemoteWorkspaceApi({ workspaceManager: manager })
    ws = createWs()
    fanout = createFanout()
  })

  describe('workspace:listRecent', () => {
    test('返回最近列表并标注 isCurrent（与当前工作区一致为 true）', async () => {
      lastWorkspaceStore.listRecent.mockReturnValue([
        { path: '/a', savedAt: '2026-01-02T00:00:00.000Z' },
        { path: '/b', savedAt: '2026-01-01T00:00:00.000Z' }
      ])
      manager.current.mockReturnValue({ path: '/a', status: 'ready' })

      await api.handleMessage(ws, { type: 'workspace:listRecent', requestId: 'req-lr' })

      expect(ws.send).toHaveBeenCalledWith('workspace:listRecent', {
        requestId: 'req-lr',
        success: true,
        recent: [
          { path: '/a', savedAt: '2026-01-02T00:00:00.000Z', isCurrent: true },
          { path: '/b', savedAt: '2026-01-01T00:00:00.000Z', isCurrent: false }
        ]
      })
    })

    test('requestId 缺省时自动生成（req_<ts>_<rand> 格式）', async () => {
      lastWorkspaceStore.listRecent.mockReturnValue([])
      manager.current.mockReturnValue(null)

      await api.handleMessage(ws, { type: 'workspace:listRecent' })

      const sent = ws.send.mock.calls.find(c => c[0] === 'workspace:listRecent')[1]
      expect(sent.requestId).toMatch(/^req_\d+_[a-z0-9]+$/)
      expect(sent.success).toBe(true)
    })
  })

  describe('workspace:open', () => {
    test('成功：调 workspaceManager.open + 广播 workspace:changed + 更新 lastWorkspaceStore', async () => {
      manager.open.mockResolvedValue({ path: '/a', status: 'ready' })
      manager.current.mockReturnValue({ path: '/a', status: 'ready' })

      await api.handleMessage(ws, { type: 'workspace:open', requestId: 'req-o', path: '/a' }, fanout)

      expect(manager.open).toHaveBeenCalledWith('/a')
      expect(fanout.send).toHaveBeenCalledWith('workspace:changed', { path: '/a' })
      expect(lastWorkspaceStore.set).toHaveBeenCalledWith('/a')
      expect(ws.send).toHaveBeenCalledWith('workspace:open', {
        requestId: 'req-o', success: true, path: '/a'
      })
    })

    test('失败：不广播、不更新 store，回 { success:false, error }', async () => {
      manager.open.mockRejectedValue(new Error('PATH_INVALID'))

      await api.handleMessage(ws, { type: 'workspace:open', requestId: 'req-oe', path: '/bad' }, fanout)

      expect(fanout.send).not.toHaveBeenCalled()
      expect(lastWorkspaceStore.set).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('workspace:open', {
        requestId: 'req-oe', success: false, error: 'PATH_INVALID'
      })
    })

    test('缺 path → 回 { success:false }，不调 open', async () => {
      await api.handleMessage(ws, { type: 'workspace:open', requestId: 'req-o2' }, fanout)

      expect(manager.open).not.toHaveBeenCalled()
      expect(fanout.send).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('workspace:open', expect.objectContaining({ success: false }))
    })

    test('未注入 workspaceManager（且无 global 单例）→ WORKSPACE_MANAGER_NOT_AVAILABLE', async () => {
      const bare = new RemoteWorkspaceApi()

      await bare.handleMessage(ws, { type: 'workspace:open', requestId: 'req-o3', path: '/x' }, fanout)

      expect(manager.open).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('workspace:open', {
        requestId: 'req-o3', success: false, error: 'WORKSPACE_MANAGER_NOT_AVAILABLE'
      })
    })
  })

  describe('workspace:current', () => {
    test('返回当前工作区 path', async () => {
      manager.current.mockReturnValue({ path: '/cur', status: 'ready' })

      await api.handleMessage(ws, { type: 'workspace:current', requestId: 'req-c' })

      expect(ws.send).toHaveBeenCalledWith('workspace:current', {
        requestId: 'req-c', success: true, path: '/cur'
      })
    })

    test('无工作区 → path 为 null（不报错）', async () => {
      manager.current.mockReturnValue({ path: null, status: 'idle' })

      await api.handleMessage(ws, { type: 'workspace:current', requestId: 'req-c2' })

      expect(ws.send).toHaveBeenCalledWith('workspace:current', {
        requestId: 'req-c2', success: true, path: null
      })
    })
  })

  test('未知通道 → 回 CHANNEL_NOT_ALLOWED', async () => {
    await api.handleMessage(ws, { type: 'workspace:foo', requestId: 'req-x' })

    expect(ws.send).toHaveBeenCalledWith('error', { error: 'CHANNEL_NOT_ALLOWED' })
  })
})
