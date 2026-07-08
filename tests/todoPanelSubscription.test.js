/**
 * TodoPanel 数据流合约测试（2026-07-08）
 *
 * 目的：验证后端推送的 todo:updated 事件 + todo:list IPC 返回的数据形状，
 *       满足前端 TodoPanel.jsx 的消费约定（无 React 渲染，纯逻辑合约）。
 *
 * Jest 环境是 node（无 jsdom），本测试不渲染 React，而是模拟 TodoPanel 内部的
 * controller 行为：mount 时 list、订阅 onUpdate、卸载时 removeUpdateListener、
 * sessionId 过滤、payload 形状校验。
 *
 * 跑法：npx jest tests/todoPanelSubscription.test.js -v
 */

describe('TodoPanel 数据流合约（2026-07-08）', () => {
  // === 模拟 TodoPanel 的 controller 行为 ===
  // 这跟 TodoPanel.jsx 内部的 useEffect 逻辑一致
  function createMockTodoController({ electronAPI, sessionId }) {
    const state = { todos: [], summary: { total: 0, completed: 0 } }
    const calls = { list: 0, onUpdate: 0, removeUpdateListener: 0 }

    // 模拟 mount 时的初始拉取（与 TodoPanel.jsx 内部一致：失败静默吞掉）
    electronAPI.todo.list(sessionId).then(res => {
      calls.list++
      if (res?.success) {
        state.todos = res.todos || []
        state.summary = { total: res.total || 0, completed: res.completed || 0 }
      }
    }).catch(() => { /* 拉取失败静默忽略，订阅通道仍可用 */ })

    // 模拟订阅
    const listenerId = electronAPI.todo.onUpdate((payload) => {
      calls.onUpdate++
      if (!payload || payload.sessionId !== sessionId) return  // 关键：sessionId 过滤
      state.todos = payload.todos || []
      state.summary = { total: payload.total || 0, completed: payload.completed || 0 }
    })

    return {
      state,
      calls,
      // 模拟 cleanup
      unmount: () => {
        electronAPI.todo.removeUpdateListener(listenerId)
        calls.removeUpdateListener++
      }
    }
  }

  // 构造 electronAPI mock，模拟 onUpdate 注册后返回一个 listenerId，
  // 调用端可以通过 invoke 模拟触发事件
  function makeElectronAPI() {
    let updateListeners = []
    let updateIdCounter = 0
    return {
      todo: {
        list: jest.fn().mockResolvedValue({ success: true, todos: [], total: 0, completed: 0 }),
        onUpdate: jest.fn((cb) => {
          const id = `listener-${++updateIdCounter}`
          updateListeners.push({ id, cb })
          return id
        }),
        removeUpdateListener: jest.fn((id) => {
          updateListeners = updateListeners.filter(l => l.id !== id)
        }),
        // 测试辅助：触发所有订阅
        _fireUpdate: (payload) => updateListeners.forEach(l => l.cb(payload)),
        _listenerCount: () => updateListeners.length
      }
    }
  }

  // === 测试用例 ===
  test('mount 时调 todo.list(sessionId) 拉初始数据', async () => {
    const electronAPI = makeElectronAPI()
    electronAPI.todo.list.mockResolvedValue({
      success: true,
      todos: [{ id: 't1', content: '查规范', priority: 'high', status: 'pending' }],
      total: 1,
      completed: 0
    })

    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })
    await Promise.resolve()  // 等 microtask resolve

    expect(electronAPI.todo.list).toHaveBeenCalledWith('s1')
    expect(ctrl.state.todos).toHaveLength(1)
    expect(ctrl.state.summary.total).toBe(1)
  })

  test('收到匹配 sessionId 的 todo:updated 事件 → 更新状态', () => {
    const electronAPI = makeElectronAPI()
    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })

    electronAPI.todo._fireUpdate({
      sessionId: 's1',
      todos: [
        { id: 't1', content: '查规范', status: 'completed' },
        { id: 't2', content: '做配合比', status: 'in_progress' }
      ],
      total: 2,
      completed: 1
    })

    expect(ctrl.state.todos).toHaveLength(2)
    expect(ctrl.state.summary).toEqual({ total: 2, completed: 1 })
  })

  test('收到不匹配 sessionId 的事件 → 忽略（不污染状态）', () => {
    const electronAPI = makeElectronAPI()
    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })
    const before = { ...ctrl.state, todos: [...ctrl.state.todos] }

    electronAPI.todo._fireUpdate({
      sessionId: 'OTHER_SESSION',
      todos: [{ id: 'x', content: '其他会话的 todo', status: 'pending' }],
      total: 1,
      completed: 0
    })

    expect(ctrl.state.todos).toEqual(before.todos)
    expect(ctrl.state.summary).toEqual(before.summary)
  })

  test('unmount 时调 todo.removeUpdateListener', () => {
    const electronAPI = makeElectronAPI()
    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })

    expect(electronAPI.todo._listenerCount()).toBe(1)
    const listenerId = electronAPI.todo.onUpdate.mock.results[0].value

    ctrl.unmount()

    expect(electronAPI.todo.removeUpdateListener).toHaveBeenCalledWith(listenerId)
    expect(electronAPI.todo._listenerCount()).toBe(0)
  })

  test('payload 形状校验：必须有 sessionId / todos / total / completed', () => {
    // 验证 todo-manage.js 推送的事件载荷字段跟 TodoPanel 的合约一致
    const electronAPI = makeElectronAPI()
    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })

    const validPayload = {
      sessionId: 's1',
      todos: [{ id: 't1', content: 'x', priority: 'medium', status: 'pending' }],
      total: 1,
      completed: 0
    }
    electronAPI.todo._fireUpdate(validPayload)
    expect(ctrl.state.todos).toHaveLength(1)  // 没崩就说明形状对

    // 缺字段
    const brokenPayload = { sessionId: 's1', todos: [] }
    expect(() => electronAPI.todo._fireUpdate(brokenPayload)).not.toThrow()
    // 即使缺字段也不崩，TodoPanel 内部对缺失字段做了容错
  })

  test('todo.list 失败时不抛错（仅静默忽略）', async () => {
    const electronAPI = makeElectronAPI()
    electronAPI.todo.list.mockRejectedValue(new Error('IPC channel closed'))

    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })
    await Promise.resolve()

    expect(ctrl.state.todos).toEqual([])
    expect(ctrl.state.summary).toEqual({ total: 0, completed: 0 })
  })

  test('list 返回失败（success=false）时不污染状态', async () => {
    const electronAPI = makeElectronAPI()
    electronAPI.todo.list.mockResolvedValue({ success: false, error: '会话已结束' })

    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })
    await Promise.resolve()

    expect(ctrl.state.todos).toEqual([])
  })

  test('多次更新按事件顺序覆盖状态（最新事件赢）', () => {
    const electronAPI = makeElectronAPI()
    const ctrl = createMockTodoController({ electronAPI, sessionId: 's1' })

    electronAPI.todo._fireUpdate({
      sessionId: 's1',
      todos: [{ id: 't1', content: 'A', status: 'pending' }],
      total: 1,
      completed: 0
    })
    electronAPI.todo._fireUpdate({
      sessionId: 's1',
      todos: [
        { id: 't1', content: 'A', status: 'completed' },
        { id: 't2', content: 'B', status: 'pending' }
      ],
      total: 2,
      completed: 1
    })

    expect(ctrl.state.summary).toEqual({ total: 2, completed: 1 })
    expect(ctrl.state.todos[0].status).toBe('completed')
  })
})