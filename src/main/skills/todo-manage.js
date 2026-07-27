/**
 * Todo 任务管理 Skill
 *
 * 让 Agent 能维护一个跨轮次可见的任务清单，支持 create / add / update / complete / list / clear
 * 六种操作。状态可流转（pending → in_progress → completed）。
 *
 * 设计要点：
 * - 纯内存存储（模块级 Map<sessionId, Todo[]>），不依赖外部服务
 * - services: [] 显式声明，避免 DynamicContextProvider 抛 services_undeclared
 * - 从 context.sessionId 拿会话 ID（由 SkillExecutor.execute 第三参数 runtimeCtx 注入）
 * - 会话结束时由 agentHandler 调用 _cleanupSession 清理，防内存泄漏
 * - 不驱动 Agent 主循环——Agent 是否按清单执行由 LLM 自行决定
 */

const crypto = require('crypto')

// 模块级存储：Map<sessionId, Todo[]>
// 不暴露给外部，仅通过 execute 操作
const _sessionTodos = new Map()

// 单个 Todo 结构：
// { id, content, priority, status, createdAt, updatedAt }
// - priority: 'high' | 'medium' | 'low'
// - status:   'pending' | 'in_progress' | 'completed'

const VALID_ACTIONS = ['create', 'add', 'update', 'complete', 'list', 'clear']
const VALID_PRIORITIES = ['high', 'medium', 'low']
const VALID_STATUSES = ['pending', 'in_progress', 'completed']

function _getTodos(sessionId) {
  if (!_sessionTodos.has(sessionId)) _sessionTodos.set(sessionId, [])
  return _sessionTodos.get(sessionId)
}

function _newTodo(content, priority = 'medium') {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    content,
    priority: VALID_PRIORITIES.includes(priority) ? priority : 'medium',
    status: 'pending',
    createdAt: now,
    updatedAt: now
  }
}

function _summarize(todos) {
  return {
    total: todos.length,
    completed: todos.filter(t => t.status === 'completed').length
  }
}

function _findTodo(todos, id) {
  return todos.find(t => t.id === id)
}

/**
 * 把当前 todo 状态推给渲染进程（todo:updated 事件）
 * - 没有 webContents（如单元测试场景）静默跳过
 * - webContents 已销毁（用户切页/关闭窗口）也跳过
 * - 推送失败 catch 吞掉，不影响 skill 主流程
 */
function _notifyTodoUpdate(context, sessionId, todos) {
  try {
    const wc = context?.webContents
    if (!wc) return
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return
    wc.send('todo:updated', {
      sessionId,
      todos,
      total: todos.length,
      completed: todos.filter(t => t.status === 'completed').length
    })
  } catch (_) { /* 推送失败不影响主流程 */ }
}

const skill = {
  name: 'todo_manage',
  description: '管理任务清单。支持创建/追加/更新/完成/列出/清空任务。让 Agent 在多步骤任务中维护可见计划，状态可流转 pending → in_progress → completed。',
  version: '1.0.0',
  category: 'agent',
  // 显式空数组：DynamicContextProvider.getServices 要求 services 字段必须声明
  // 本 skill 不依赖任何外部服务，纯内存操作
  services: [],

  parameters: {
    action: {
      type: 'string',
      description: '操作类型：create(用一组任务初始化整个清单，覆盖旧清单) / add(追加单个任务) / update(修改某个任务) / complete(标记任务为已完成) / list(返回当前清单) / clear(清空清单)',
      required: true,
      enum: VALID_ACTIONS
    },
    todos: {
      type: 'array',
      description: 'create 操作时传入的任务数组',
      required: false,
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '任务内容' },
          priority: { type: 'string', enum: VALID_PRIORITIES }
        }
      }
    },
    todo: {
      type: 'object',
      description: 'add/update 操作时传入的单个任务',
      required: false,
      properties: {
        id: { type: 'string', description: '任务 ID（update 必填，add 时忽略）' },
        content: { type: 'string', description: '任务内容' },
        priority: { type: 'string', enum: VALID_PRIORITIES },
        status: { type: 'string', enum: VALID_STATUSES }
      }
    },
    id: {
      type: 'string',
      description: 'complete 操作时传入的任务 ID',
      required: false
    }
  },

  errors: {
    E_TODO_INVALID_ACTION: {
      code: 'E_TODO_INVALID_ACTION',
      message: '未知的 action',
      hint: `action 必须是 ${VALID_ACTIONS.join(' / ')} 之一`,
      recovery: 'retry'
    },
    E_TODO_INVALID_ARGS: {
      code: 'E_TODO_INVALID_ARGS',
      message: '参数不合法',
      hint: '请检查参数是否符合 action 要求',
      recovery: 'retry'
    },
    E_TODO_NOT_FOUND: {
      code: 'E_TODO_NOT_FOUND',
      message: '任务不存在',
      hint: '请通过 list 查看当前清单，确认 id 正确',
      recovery: 'retry'
    },
    E_TODO_NO_SESSION: {
      code: 'E_TODO_NO_SESSION',
      message: 'context 未注入 sessionId',
      hint: '请联系开发者检查 SkillExecutor runtimeCtx 注入',
      recovery: 'none'
    }
  },

  async execute(args, context) {
    const { action } = args
    const { sessionId, logger } = context

    if (!sessionId) {
      return { success: false, error: 'context 未注入 sessionId，无法隔离会话' }
    }

    if (!VALID_ACTIONS.includes(action)) {
      return { success: false, error: `未知的 action: ${action}。必须是 ${VALID_ACTIONS.join(' / ')} 之一` }
    }

    logger?.info(`[todo_manage] action=${action} sessionId=${sessionId}`)

    const todos = _sessionTodos.has(sessionId) ? _sessionTodos.get(sessionId) : []

    switch (action) {
      case 'create': {
        const newTodosInput = Array.isArray(args.todos) ? args.todos : []
        if (newTodosInput.length === 0) {
          return { success: false, error: 'create 操作需要 todos 数组且不能为空' }
        }
        const created = newTodosInput.map(t => {
          if (!t || !t.content) {
            throw new Error('每个 todo 必须有 content 字段')
          }
          return _newTodo(t.content, t.priority)
        })
        _sessionTodos.set(sessionId, created)
        _notifyTodoUpdate(context, sessionId, created)
        return {
          success: true,
          action: 'create',
          todos: created,
          ..._summarize(created)
        }
      }

      case 'add': {
        if (!args.todo || !args.todo.content) {
          return { success: false, error: 'add 操作需要 todo.content 字段' }
        }
        const current = _getTodos(sessionId)
        const added = _newTodo(args.todo.content, args.todo.priority)
        current.push(added)
        _notifyTodoUpdate(context, sessionId, current)
        return {
          success: true,
          action: 'add',
          todo: added,
          ..._summarize(current)
        }
      }

      case 'update': {
        if (!args.todo || !args.todo.id) {
          return { success: false, error: 'update 操作需要 todo.id 字段' }
        }
        const current = _getTodos(sessionId)
        const target = _findTodo(current, args.todo.id)
        if (!target) {
          return { success: false, error: `任务不存在: ${args.todo.id}` }
        }
        if (args.todo.content !== undefined) target.content = args.todo.content
        if (args.todo.priority && VALID_PRIORITIES.includes(args.todo.priority)) {
          target.priority = args.todo.priority
        }
        if (args.todo.status && VALID_STATUSES.includes(args.todo.status)) {
          target.status = args.todo.status
        }
        target.updatedAt = new Date().toISOString()
        _notifyTodoUpdate(context, sessionId, current)
        return {
          success: true,
          action: 'update',
          todo: target,
          ..._summarize(current)
        }
      }

      case 'complete': {
        if (!args.id) {
          return { success: false, error: 'complete 操作需要 id 字段' }
        }
        const current = _getTodos(sessionId)
        const target = _findTodo(current, args.id)
        if (!target) {
          return { success: false, error: `任务不存在: ${args.id}` }
        }
        // 幂等：已完成的任务再 complete 不报错
        target.status = 'completed'
        target.updatedAt = new Date().toISOString()
        _notifyTodoUpdate(context, sessionId, current)
        return {
          success: true,
          action: 'complete',
          todo: target,
          ..._summarize(current)
        }
      }

      case 'list': {
        const current = _getTodos(sessionId)
        return {
          success: true,
          action: 'list',
          todos: current,
          ..._summarize(current)
        }
      }

      case 'clear': {
        _sessionTodos.delete(sessionId)
        _notifyTodoUpdate(context, sessionId, [])
        return {
          success: true,
          action: 'clear',
          todos: [],
          total: 0,
          completed: 0
        }
      }

      default:
        return { success: false, error: `未知的 action: ${action}` }
    }
  }
}

/**
 * 清理指定会话的 Todo 数据（由 agentHandler 在会话结束时调用）
 * 仅在所有 todo 都已完成时删除；有未完成 todo 则保留，防误删
 * @param {string} sessionId - 会话 ID
 */
skill._cleanupSession = function _cleanupSession(sessionId) {
  if (!sessionId) return
  const todos = _sessionTodos.get(sessionId)
  if (!todos) return
  const pendingTodos = todos.filter(t => t.status !== 'completed')
  if (pendingTodos.length === 0) {
    _sessionTodos.delete(sessionId)
  }
  // 有未完成 todo → 保留，不做清理
}

/**
 * 测试用：清空所有会话的 Todo 数据（仅测试代码调用，生产代码勿用）
 */
skill._cleanupAllForTest = function _cleanupAllForTest() {
  _sessionTodos.clear()
}

module.exports = skill
