/**
 * todo_manage Skill 单元测试
 *
 * 覆盖：
 * - 6 种 action（create / add / update / complete / list / clear）
 * - 状态流转（pending → in_progress → completed）
 * - 会话隔离
 * - 边缘情况（空 list、不存在 id、非法 action、create 空数组等）
 * - _cleanupSession 清理
 */

const todoManage = require('../../skills/todo-manage')

const _ctx = (sessionId = 'test-1') => ({
  sessionId,
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
})

beforeEach(() => {
  // 每个测试前清空所有会话的 Todo
  todoManage._cleanupAllForTest()
})

describe('todo_manage Skill - schema 与元数据', () => {
  test('skill 元数据完整', () => {
    expect(todoManage.name).toBe('todo_manage')
    expect(todoManage.description).toBeTruthy()
    expect(todoManage.version).toBe('1.0.0')
    expect(todoManage.category).toBe('agent')
    expect(todoManage.services).toEqual([])
    expect(typeof todoManage.execute).toBe('function')
  })

  test('parameters 包含 action 字段且为枚举', () => {
    expect(todoManage.parameters.action).toBeDefined()
    expect(todoManage.parameters.action.required).toBe(true)
    expect(todoManage.parameters.action.enum).toEqual(
      ['create', 'add', 'update', 'complete', 'list', 'clear']
    )
  })

  test('errors 定义了 4 个错误码', () => {
    const codes = Object.keys(todoManage.errors)
    expect(codes).toContain('E_TODO_INVALID_ACTION')
    expect(codes).toContain('E_TODO_INVALID_ARGS')
    expect(codes).toContain('E_TODO_NOT_FOUND')
    expect(codes).toContain('E_TODO_NO_SESSION')
  })
})

describe('todo_manage Skill - create action', () => {
  test('create 用一组任务初始化清单', async () => {
    const result = await todoManage.execute({
      action: 'create',
      todos: [
        { content: '查规范', priority: 'high' },
        { content: '做配合比', priority: 'medium' },
        { content: '生成报告' }
      ]
    }, _ctx())

    expect(result.success).toBe(true)
    expect(result.action).toBe('create')
    expect(result.todos).toHaveLength(3)
    expect(result.total).toBe(3)
    expect(result.completed).toBe(0)
    expect(result.todos[0].content).toBe('查规范')
    expect(result.todos[0].priority).toBe('high')
    expect(result.todos[0].status).toBe('pending')
    expect(result.todos[0].id).toBeTruthy()
    expect(result.todos[0].createdAt).toBeTruthy()
  })

  test('create 覆盖旧清单', async () => {
    await todoManage.execute({
      action: 'create',
      todos: [{ content: '任务 A' }]
    }, _ctx('override-1'))

    const result = await todoManage.execute({
      action: 'create',
      todos: [{ content: '任务 B' }, { content: '任务 C' }]
    }, _ctx('override-1'))

    expect(result.total).toBe(2)
    expect(result.todos[0].content).toBe('任务 B')
  })

  test('create 空数组返回错误', async () => {
    const result = await todoManage.execute({
      action: 'create',
      todos: []
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/不能为空/)
  })

  test('create 缺 todos 字段返回错误', async () => {
    const result = await todoManage.execute({
      action: 'create'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/不能为空/)
  })

  test('create 时未传 priority 默认 medium', async () => {
    const result = await todoManage.execute({
      action: 'create',
      todos: [{ content: '无优先级' }]
    }, _ctx())

    expect(result.todos[0].priority).toBe('medium')
  })

  test('create 时非法 priority 回退到 medium', async () => {
    const result = await todoManage.execute({
      action: 'create',
      todos: [{ content: '非法优先级', priority: 'urgent' }]
    }, _ctx())

    expect(result.todos[0].priority).toBe('medium')
  })
})

describe('todo_manage Skill - add action', () => {
  test('add 追加单个任务到清单', async () => {
    await todoManage.execute({
      action: 'create',
      todos: [{ content: '初始任务' }]
    }, _ctx('add-1'))

    const result = await todoManage.execute({
      action: 'add',
      todo: { content: '追加任务', priority: 'low' }
    }, _ctx('add-1'))

    expect(result.success).toBe(true)
    expect(result.action).toBe('add')
    expect(result.todo.content).toBe('追加任务')
    expect(result.todo.priority).toBe('low')
    expect(result.todo.status).toBe('pending')
    expect(result.total).toBe(2)
  })

  test('add 到空清单也能工作', async () => {
    const result = await todoManage.execute({
      action: 'add',
      todo: { content: '第一个任务' }
    }, _ctx('add-empty'))

    expect(result.success).toBe(true)
    expect(result.total).toBe(1)
  })

  test('add 缺 content 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'add',
      todo: { priority: 'high' }
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/content/)
  })

  test('add 缺 todo 字段返回错误', async () => {
    const result = await todoManage.execute({
      action: 'add'
    }, _ctx())

    expect(result.success).toBe(false)
  })
})

describe('todo_manage Skill - update action', () => {
  test('update 修改任务内容', async () => {
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: '原内容' }]
    }, _ctx('upd-1'))
    const id = created.todos[0].id

    const result = await todoManage.execute({
      action: 'update',
      todo: { id, content: '新内容', status: 'in_progress' }
    }, _ctx('upd-1'))

    expect(result.success).toBe(true)
    expect(result.todo.content).toBe('新内容')
    expect(result.todo.status).toBe('in_progress')
    // updatedAt 字段存在（同毫秒内可能未变化，不强制要求不同）
    expect(result.todo.updatedAt).toBeTruthy()
  })

  test('update 不存在的 id 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'update',
      todo: { id: 'nonexistent-id', content: 'x' }
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/不存在/)
  })

  test('update 缺 id 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'update',
      todo: { content: 'x' }
    }, _ctx())

    expect(result.success).toBe(false)
  })
})

describe('todo_manage Skill - complete action', () => {
  test('complete 标记任务为已完成', async () => {
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }, { content: 'B' }]
    }, _ctx('cmp-1'))
    const id = created.todos[0].id

    const result = await todoManage.execute({
      action: 'complete',
      id
    }, _ctx('cmp-1'))

    expect(result.success).toBe(true)
    expect(result.todo.status).toBe('completed')
    expect(result.completed).toBe(1)
    expect(result.total).toBe(2)
  })

  test('complete 已完成的任务幂等（不报错）', async () => {
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, _ctx('cmp-idempotent'))
    const id = created.todos[0].id

    await todoManage.execute({ action: 'complete', id }, _ctx('cmp-idempotent'))
    const result = await todoManage.execute({ action: 'complete', id }, _ctx('cmp-idempotent'))

    expect(result.success).toBe(true)
    expect(result.todo.status).toBe('completed')
    expect(result.completed).toBe(1)
  })

  test('complete 不存在的 id 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'complete',
      id: 'nonexistent-id'
    }, _ctx())

    expect(result.success).toBe(false)
  })

  test('complete 缺 id 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'complete'
    }, _ctx())

    expect(result.success).toBe(false)
  })
})

describe('todo_manage Skill - list action', () => {
  test('list 返回当前清单', async () => {
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }, { content: 'B' }]
    }, _ctx('lst-1'))

    const result = await todoManage.execute({
      action: 'list'
    }, _ctx('lst-1'))

    expect(result.success).toBe(true)
    expect(result.action).toBe('list')
    expect(result.todos).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.completed).toBe(0)
  })

  test('list 空清单返回空数组（非错误）', async () => {
    const result = await todoManage.execute({
      action: 'list'
    }, _ctx('empty-session'))

    expect(result.success).toBe(true)
    expect(result.todos).toEqual([])
    expect(result.total).toBe(0)
    expect(result.completed).toBe(0)
  })
})

describe('todo_manage Skill - clear action', () => {
  test('clear 清空清单', async () => {
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }, { content: 'B' }]
    }, _ctx('clr-1'))

    const result = await todoManage.execute({
      action: 'clear'
    }, _ctx('clr-1'))

    expect(result.success).toBe(true)
    expect(result.action).toBe('clear')
    expect(result.todos).toEqual([])
    expect(result.total).toBe(0)
    expect(result.completed).toBe(0)

    // clear 后再 list 确认是空的
    const listResult = await todoManage.execute({
      action: 'list'
    }, _ctx('clr-1'))
    expect(listResult.todos).toEqual([])
  })
})

describe('todo_manage Skill - 会话隔离', () => {
  test('不同 sessionId 互不影响', async () => {
    // 会话 A 创建清单
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A-1' }]
    }, _ctx('sess-A'))

    // 会话 B 创建清单
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'B-1' }, { content: 'B-2' }]
    }, _ctx('sess-B'))

    // A 的 list 不应包含 B 的任务
    const aList = await todoManage.execute({ action: 'list' }, _ctx('sess-A'))
    expect(aList.total).toBe(1)
    expect(aList.todos[0].content).toBe('A-1')

    // B 的 list 不应包含 A 的任务
    const bList = await todoManage.execute({ action: 'list' }, _ctx('sess-B'))
    expect(bList.total).toBe(2)
    expect(bList.todos[0].content).toBe('B-1')
  })

  test('A 会话的 add 不影响 B 会话', async () => {
    await todoManage.execute({
      action: 'create',
      todos: [{ content: '初始' }]
    }, _ctx('iso-A'))
    await todoManage.execute({
      action: 'create',
      todos: [{ content: '初始' }]
    }, _ctx('iso-B'))

    await todoManage.execute({
      action: 'add',
      todo: { content: 'A 新增' }
    }, _ctx('iso-A'))

    const aList = await todoManage.execute({ action: 'list' }, _ctx('iso-A'))
    const bList = await todoManage.execute({ action: 'list' }, _ctx('iso-B'))

    expect(aList.total).toBe(2)
    expect(bList.total).toBe(1)
  })
})

describe('todo_manage Skill - _cleanupSession', () => {
  test('清理后 list 返回空', async () => {
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }, { content: 'B' }, { content: 'C' }]
    }, _ctx('cleanup-1'))
    // 全部完成后才能被 cleanup 删除
    for (const t of created.todos) {
      await todoManage.execute({ action: 'complete', id: t.id }, _ctx('cleanup-1'))
    }

    todoManage._cleanupSession('cleanup-1')

    const result = await todoManage.execute({ action: 'list' }, _ctx('cleanup-1'))
    expect(result.total).toBe(0)
    expect(result.todos).toEqual([])
  })

  test('清理 A 不影响 B', async () => {
    const createdA = await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A-1' }]
    }, _ctx('cleanup-A'))
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'B-1' }]
    }, _ctx('cleanup-B'))
    // 完成 A 所有的任务后 cleanup 才能删除
    for (const t of createdA.todos) {
      await todoManage.execute({ action: 'complete', id: t.id }, _ctx('cleanup-A'))
    }

    todoManage._cleanupSession('cleanup-A')

    const aList = await todoManage.execute({ action: 'list' }, _ctx('cleanup-A'))
    const bList = await todoManage.execute({ action: 'list' }, _ctx('cleanup-B'))
    expect(aList.total).toBe(0)
    expect(bList.total).toBe(1)
  })

  test('_cleanupSession 不存在的 sessionId 不报错', () => {
    expect(() => todoManage._cleanupSession('nonexistent')).not.toThrow()
  })

  test('_cleanupSession 缺 sessionId 参数不报错', () => {
    expect(() => todoManage._cleanupSession()).not.toThrow()
  })

  test('_cleanupSession: 有未完成 todo 时保留', async () => {
    // 写入一个未完成的 todo
    const result = await todoManage.execute({
      action: 'create',
      todos: [{ content: '未完成任务' }]
    }, _ctx('s1'))
    expect(result.total).toBe(1)

    todoManage._cleanupSession('s1')

    // 清单不应被删除
    const listResult = await todoManage.execute({ action: 'list' }, _ctx('s1'))
    expect(listResult.total).toBe(1)
    expect(listResult.todos[0].content).toBe('未完成任务')
  })

  test('_cleanupSession: 全部完成时清理', async () => {
    // 创建任务并完成
    const createResult = await todoManage.execute({
      action: 'create',
      todos: [{ content: '已完成任务' }]
    }, _ctx('s2'))
    expect(createResult.total).toBe(1)

    const completeResult = await todoManage.execute({
      action: 'complete',
      id: createResult.todos[0].id
    }, _ctx('s2'))
    expect(completeResult.success).toBe(true)

    // 全部完成，应该清理
    todoManage._cleanupSession('s2')

    const listResult = await todoManage.execute({ action: 'list' }, _ctx('s2'))
    expect(listResult.total).toBe(0)
    expect(listResult.todos).toEqual([])
  })
})

describe('todo_manage Skill - 错误处理', () => {
  test('未知 action 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'unknown'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unknown/)
  })

  test('缺 sessionId 返回错误', async () => {
    const result = await todoManage.execute({
      action: 'list'
    }, { logger: { info: jest.fn() } })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/sessionId/)
  })
})

describe('todo_manage Skill - 状态流转', () => {
  test('完整生命周期：create → update(in_progress) → complete', async () => {
    // 1. create
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: '做配合比', priority: 'high' }]
    }, _ctx('life-1'))
    expect(created.todos[0].status).toBe('pending')

    // 2. update 到 in_progress
    const id = created.todos[0].id
    const inProgress = await todoManage.execute({
      action: 'update',
      todo: { id, status: 'in_progress' }
    }, _ctx('life-1'))
    expect(inProgress.todo.status).toBe('in_progress')
    expect(inProgress.completed).toBe(0)

    // 3. complete
    const completed = await todoManage.execute({
      action: 'complete',
      id
    }, _ctx('life-1'))
    expect(completed.todo.status).toBe('completed')
    expect(completed.completed).toBe(1)
  })

  test('多次 add 后 total/completed 计数正确', async () => {
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }, { content: 'B' }]
    }, _ctx('count-1'))

    await todoManage.execute({
      action: 'add',
      todo: { content: 'C' }
    }, _ctx('count-1'))
    await todoManage.execute({
      action: 'add',
      todo: { content: 'D' }
    }, _ctx('count-1'))

    const list = await todoManage.execute({ action: 'list' }, _ctx('count-1'))
    expect(list.total).toBe(4)
    expect(list.completed).toBe(0)

    // 完成 2 个
    const ids = list.todos.map(t => t.id)
    await todoManage.execute({ action: 'complete', id: ids[0] }, _ctx('count-1'))
    await todoManage.execute({ action: 'complete', id: ids[2] }, _ctx('count-1'))

    const after = await todoManage.execute({ action: 'list' }, _ctx('count-1'))
    expect(after.total).toBe(4)
    expect(after.completed).toBe(2)
  })
})

// === Todo 计划面板（2026-07-08）：推送事件测试 ===
// 验证写操作完成后会通过 context.webContents.send('todo:updated', ...) 推事件
describe('todo_manage Skill - todo:updated 事件推送', () => {
  // 构造带 spy 的 context.webContents
  const _ctxWithWC = (sessionId = 'push-1') => {
    const sendSpy = jest.fn()
    const ctx = _ctx(sessionId)
    ctx.webContents = { send: sendSpy, isDestroyed: () => false }
    return { ctx, sendSpy }
  }

  test('create 触发一次推送', async () => {
    const { ctx, sendSpy } = _ctxWithWC('push-create')
    await todoManage.execute({
      action: 'create',
      todos: [{ content: '任务1', priority: 'high' }]
    }, ctx)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledWith('todo:updated', expect.objectContaining({
      sessionId: 'push-create',
      total: 1,
      completed: 0,
      todos: expect.arrayContaining([expect.objectContaining({ content: '任务1' })])
    }))
  })

  test('add 触发推送', async () => {
    const { ctx, sendSpy } = _ctxWithWC('push-add')
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, ctx)
    sendSpy.mockClear()
    await todoManage.execute({
      action: 'add',
      todo: { content: 'B' }
    }, ctx)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0]).toBe('todo:updated')
    expect(sendSpy.mock.calls[0][1].total).toBe(2)
  })

  test('update 触发推送', async () => {
    const { ctx, sendSpy } = _ctxWithWC('push-update')
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: '原内容' }]
    }, ctx)
    sendSpy.mockClear()
    await todoManage.execute({
      action: 'update',
      todo: { id: created.todos[0].id, content: '新内容' }
    }, ctx)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][1].todos[0].content).toBe('新内容')
  })

  test('complete 触发推送且 completed 计数正确', async () => {
    const { ctx, sendSpy } = _ctxWithWC('push-complete')
    const created = await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }, { content: 'B' }]
    }, ctx)
    sendSpy.mockClear()
    await todoManage.execute({
      action: 'complete',
      id: created.todos[0].id
    }, ctx)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      sessionId: 'push-complete',
      total: 2,
      completed: 1
    }))
  })

  test('clear 触发推送且 todos 为空', async () => {
    const { ctx, sendSpy } = _ctxWithWC('push-clear')
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, ctx)
    sendSpy.mockClear()
    await todoManage.execute({ action: 'clear' }, ctx)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      sessionId: 'push-clear',
      todos: [],
      total: 0,
      completed: 0
    }))
  })

  test('list 不触发推送（只读操作）', async () => {
    const { ctx, sendSpy } = _ctxWithWC('push-list')
    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, ctx)
    sendSpy.mockClear()
    await todoManage.execute({ action: 'list' }, ctx)

    expect(sendSpy).not.toHaveBeenCalled()
  })

  test('没有 webContents 时静默跳过推送', async () => {
    const ctx = _ctx('push-no-wc')  // 无 webContents
    await expect(todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, ctx)).resolves.toBeTruthy()
  })

  test('webContents 已销毁时不推送', async () => {
    const sendSpy = jest.fn()
    const ctx = _ctx('push-destroyed')
    ctx.webContents = { send: sendSpy, isDestroyed: () => true }

    await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, ctx)

    expect(sendSpy).not.toHaveBeenCalled()
  })

  test('webContents.send 抛错时不影响主流程', async () => {
    const ctx = _ctx('push-throw')
    ctx.webContents = {
      send: jest.fn(() => { throw new Error('IPC channel closed') }),
      isDestroyed: () => false
    }

    const result = await todoManage.execute({
      action: 'create',
      todos: [{ content: 'A' }]
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.todos).toHaveLength(1)
  })
})
