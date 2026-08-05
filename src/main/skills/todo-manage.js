/**
 * Todo 任务管理 Skill
 *
 * 让 Agent 能维护一个跨轮次可见的任务清单，支持 create / add / update / complete / list / clear
 * / restore / create_plan / retry / replace_plan / approve_plan 十一种操作。状态可流转（pending → in_progress → completed / failed）。
 * create_plan 用于 ≥5 步强制规划（LLM 先规划、用户审批后执行）；replace_plan 用于用户编辑后回传；
 * approve_plan 用于用户点击【确认】后清除待审批标记（计划生效）；retry 用于步骤重跑（retryCount++，
 * 超过 maxRetry 标记 failed）。计划步骤可携带 suggestedSkill / expectedParams / dependencies 等元数据，
 * 供技能路由（getRelevantToolSchemas）和重跑使用。
 *
 * 设计要点：
 * - 纯内存存储（模块级 Map<sessionId, Todo[]>），不依赖外部服务
 * - services: [] 显式声明，避免 DynamicContextProvider 抛 services_undeclared
 * - 从 context.sessionId 拿会话 ID（由 SkillExecutor.execute 第三参数 runtimeCtx 注入）
 * - 会话结束时由 agentHandler 调用 _cleanupSession 清理，防内存泄漏
 * - 不驱动 Agent 主循环——Agent 是否按清单执行由 LLM 自行决定
 *
 * 计划审批（阶段 3 任务 3.3）：
 * - _sessionPlanPending 记录每个会话的计划是否待审批（模块级 Map<sessionId, boolean>，纯内存不落库）
 * - create_plan 置 true（前端据此弹 PlanApprovalModal）；approve_plan / replace_plan / create / clear
 *   / restore 置 false（计划生效或取消）；list / todo:updated 事件把 pendingApproval 带给前端
 * - 断点续跑恢复快照时 pendingApproval 不持久化 → 默认 false（优雅降级，不再弹审批窗）
 */

const crypto = require('crypto')

// 模块级存储：Map<sessionId, Todo[]>
// 不暴露给外部，仅通过 execute 操作
const _sessionTodos = new Map()

// 模块级存储：Map<sessionId, boolean>，标记当前计划是否待审批（create_plan 置 true）
const _sessionPlanPending = new Map()

// 单个 Todo 结构（阶段 3 增强，基于原结构扩展，不破坏现有字段）：
// { id, content, priority, status, createdAt, updatedAt, suggestedSkill?, expectedParams?, retryCount, maxRetry, dependencies }
// - priority: 'high' | 'medium' | 'low'
// - status:   'pending' | 'in_progress' | 'completed' | 'failed'
// - suggestedSkill：执行本步骤建议使用的 skill 名称（技能路由用）
// - expectedParams：调用 suggestedSkill 时的参数对象
// - retryCount / maxRetry：重跑计数与上限，retryCount >= maxRetry 时标记 failed
// - dependencies：本步骤依赖的其他步骤 id 数组

const DEFAULT_MAX_RETRY = 3
const VALID_ACTIONS = ['create', 'add', 'update', 'complete', 'list', 'clear', 'restore', 'create_plan', 'retry', 'replace_plan', 'approve_plan']
const VALID_PRIORITIES = ['high', 'medium', 'low']
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'failed']

function _getTodos(sessionId) {
  if (!_sessionTodos.has(sessionId)) _sessionTodos.set(sessionId, [])
  return _sessionTodos.get(sessionId)
}

/**
 * 新建一个 Todo
 * @param {object} extra - 计划步骤元数据：id / suggestedSkill / expectedParams / maxRetry / dependencies / priority
 */
function _newTodo(content, priority = 'medium', extra = {}) {
  const now = new Date().toISOString()
  return {
    id: extra.id || crypto.randomUUID(),
    content,
    priority: VALID_PRIORITIES.includes(priority) ? priority : 'medium',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    suggestedSkill: extra.suggestedSkill || undefined,
    expectedParams: extra.expectedParams || undefined,
    retryCount: 0,
    maxRetry: (typeof extra.maxRetry === 'number' && extra.maxRetry >= 1) ? extra.maxRetry : DEFAULT_MAX_RETRY,
    dependencies: Array.isArray(extra.dependencies) ? extra.dependencies : []
  }
}

/**
 * 从 steps 数组构建计划 Todo 列表（create_plan / replace_plan 共用）
 * - 调用前 execute 已校验 steps 非空且每步有 content
 * - 保留步骤原有 id（前端编辑回传场景），无 id 则生成新 UUID
 */
function _planTodosFromSteps(steps) {
  return steps.map(s => _newTodo(s.content, s.priority, s))
}

function _summarize(todos) {
  return {
    total: todos.length,
    completed: todos.filter(t => t.status === 'completed').length,
    failed: todos.filter(t => t.status === 'failed').length
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
 * - pendingApproval 随事件带给前端：create_plan 后为 true，前端据此弹计划审批窗
 */
function _notifyTodoUpdate(context, sessionId, todos) {
  try {
    const wc = context?.webContents
    if (!wc) return
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return
    wc.send('todo:updated', {
      sessionId,
      todos,
      pendingApproval: _sessionPlanPending.get(sessionId) || false,
      total: todos.length,
      completed: todos.filter(t => t.status === 'completed').length,
      failed: todos.filter(t => t.status === 'failed').length
    })
  } catch (_) { /* 推送失败不影响主流程 */ }
}

/**
 * 把当前 todos 快照 upsert 到 agent_checkpoint 表（断点续跑用）
 * - 延迟 require 避免 DB 未初始化时循环依赖
 * - 失败只 warn 不抛（todo 落库是非关键路径，内存 todo 仍可用）
 * - DB 不可用（如单元测试无 DB）静默跳过
 */
async function _persistCheckpoint(sessionId, todos) {
  // 测试环境短路：better-sqlite3 native module 在 jest worker 下触发 ACCESS_VIOLATION（进程级崩溃，try/catch 拦不住）
  // 测试环境跳过落库，退回纯内存模式（与加 checkpoint 前行为一致）
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') return
  try {
    const { AgentCheckpoint } = require('../db/database')
    if (!AgentCheckpoint) return
    await AgentCheckpoint.upsert({
      sessionId,
      todoSnapshot: JSON.stringify(todos || []),
      updatedAt: new Date()
    })
  } catch (e) {
    // DB 未就绪或测试环境：静默跳过（todo 内存仍有效，仅丢失快照）
    try { console.warn(`[todo_manage] checkpoint 落库失败 sessionId=${sessionId}: ${e.message}`) } catch (_) {}
  }
}

/**
 * 从快照还原 todos 进内存 Map（续跑时调用）
 * @param {string} sessionId
 * @param {Array} todos - 快照数组
 */
function restoreFromSnapshot(sessionId, todos) {
  if (!sessionId) return
  const arr = Array.isArray(todos) ? todos : []
  _sessionTodos.set(sessionId, arr)
  return arr
}

const skill = {
  name: 'todo_manage',
  description: '管理任务清单。支持创建/追加/更新/完成/列出/清空/还原任务，以及 create_plan(强制规划，≥5 步任务先规划等用户审批)/retry(步骤重跑，超过 maxRetry 标记 failed)/replace_plan(用户编辑计划后回传，清空重建)/approve_plan(用户确认计划后生效，清除待审批标记)。让 Agent 在多步骤任务中维护可见计划，状态可流转 pending → in_progress → completed / failed。',
  version: '1.0.0',
  category: 'agent',
  // 显式空数组：DynamicContextProvider.getServices 要求 services 字段必须声明
  // 本 skill 不依赖任何外部服务，纯内存操作
  services: [],

  parameters: {
    action: {
      type: 'string',
      description: '操作类型：create(用一组任务初始化整个清单，覆盖旧清单) / add(追加单个任务) / update(修改某个任务) / complete(标记任务为已完成) / list(返回当前清单) / clear(清空清单) / restore(从快照还原清单) / create_plan(用 steps 数组构建计划，替换当前清单，≥5 步强制规划用，置 pendingApproval 待用户审批) / retry(重跑某一步，retryCount++，超过 maxRetry 标记 failed) / replace_plan(编辑计划后回传，清空重建，清除 pendingApproval) / approve_plan(用户确认计划，清除 pendingApproval，计划生效)',
      required: true,
      enum: VALID_ACTIONS
    },
    steps: {
      type: 'array',
      description: 'create_plan / replace_plan 操作时传入的计划步骤数组，每步含 content + 可选 suggestedSkill / expectedParams / priority / maxRetry / dependencies',
      required: false,
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '步骤内容' },
          priority: { type: 'string', enum: VALID_PRIORITIES },
          suggestedSkill: { type: 'string', description: '执行本步骤建议使用的 skill 名称（技能路由用）' },
          expectedParams: { type: 'object', description: '调用 suggestedSkill 时传入的参数' },
          maxRetry: { type: 'number', description: '最大重试次数，默认 3' },
          dependencies: { type: 'array', description: '本步骤依赖的其他步骤 id 数组' }
        }
      }
    },
    todos: {
      type: 'array',
      description: 'create / restore 操作时传入的任务数组',
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
      description: 'complete / retry 操作时传入的任务 ID',
      required: false
    },
    stepId: {
      type: 'string',
      description: 'retry 操作时传入的步骤 ID（与 id 等价，spec 3.4.6 示例用 stepId）',
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
        // create 重建普通清单 → 若此前有待审批计划，视为已替换
        _sessionPlanPending.set(sessionId, false)
        _notifyTodoUpdate(context, sessionId, created)
        _persistCheckpoint(sessionId, created)
        return {
          success: true,
          action: 'create',
          todos: created,
          pendingApproval: false,
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
        _persistCheckpoint(sessionId, current)
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
        _persistCheckpoint(sessionId, current)
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
        _persistCheckpoint(sessionId, current)
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
          pendingApproval: _sessionPlanPending.get(sessionId) || false,
          ..._summarize(current)
        }
      }

      case 'clear': {
        _sessionTodos.delete(sessionId)
        // 取消计划：清空清单同时清除待审批标记
        _sessionPlanPending.delete(sessionId)
        _notifyTodoUpdate(context, sessionId, [])
        _persistCheckpoint(sessionId, [])
        return {
          success: true,
          action: 'clear',
          todos: [],
          pendingApproval: false,
          total: 0,
          completed: 0,
          failed: 0
        }
      }

      case 'restore': {
        // 续跑时由 AgentMemoryService.resumeFromCheckpoint 调用：
        // 先从 DB 读 todoSnapshot，解析后传给 restoreFromSnapshot 还原内存
        // 本 action 让 LLM 也能显式触发还原（如检测到 todo 丢失时）
        const snapshot = Array.isArray(args.todos) ? args.todos : []
        const restored = restoreFromSnapshot(sessionId, snapshot)
        // restore 不持久化 pendingApproval → 默认 false（断点续跑不弹审批窗）
        _sessionPlanPending.set(sessionId, false)
        _notifyTodoUpdate(context, sessionId, restored)
        return {
          success: true,
          action: 'restore',
          todos: restored,
          pendingApproval: false,
          ..._summarize(restored)
        }
      }

      case 'create_plan':
      case 'replace_plan': {
        // create_plan：≥5 步强制规划，用 steps 数组构建计划替换当前清单，置 pendingApproval=true
        //   前端据此弹 PlanApprovalModal，用户【确认/修改/取消】后再执行（审批由前端/IPC 层做）
        // replace_plan：用户编辑计划后回传，清空重建（编辑即确认 → pendingApproval=false）
        const steps = Array.isArray(args.steps) ? args.steps : []
        if (steps.length === 0) {
          return { success: false, error: `${action} 操作需要 steps 数组且不能为空` }
        }
        if (steps.some(s => !s || !s.content)) {
          return { success: false, error: '每个计划步骤必须有 content 字段' }
        }
        const created = _planTodosFromSteps(steps)
        _sessionTodos.set(sessionId, created)
        _sessionPlanPending.set(sessionId, action === 'create_plan')
        _notifyTodoUpdate(context, sessionId, created)
        _persistCheckpoint(sessionId, created)
        return {
          success: true,
          action,
          todos: created,
          pendingApproval: action === 'create_plan',
          ..._summarize(created)
        }
      }

      case 'approve_plan': {
        // 计划审批通过：仅清除 pendingApproval，计划清单保持不动（前端【确认】按钮触发）
        const current = _getTodos(sessionId)
        _sessionPlanPending.set(sessionId, false)
        _notifyTodoUpdate(context, sessionId, current)
        return {
          success: true,
          action: 'approve_plan',
          todos: current,
          pendingApproval: false,
          ..._summarize(current)
        }
      }

      case 'retry': {
        // 步骤重跑：retryCount++；未达 maxRetry 时重置 status 为 pending 供重跑，达到/超过 maxRetry 标记 failed
        // spec 3.4.6 参数示例用 stepId，此处与 id 等价兼容
        const id = args.id || args.stepId
        if (!id) {
          return { success: false, error: 'retry 操作需要 id 字段' }
        }
        const current = _getTodos(sessionId)
        const target = _findTodo(current, id)
        if (!target) {
          return { success: false, error: `任务不存在: ${id}` }
        }
        target.retryCount = (target.retryCount || 0) + 1
        const cap = (typeof target.maxRetry === 'number' && target.maxRetry >= 1) ? target.maxRetry : DEFAULT_MAX_RETRY
        target.status = target.retryCount >= cap ? 'failed' : 'pending'
        target.updatedAt = new Date().toISOString()
        _notifyTodoUpdate(context, sessionId, current)
        _persistCheckpoint(sessionId, current)
        return {
          success: true,
          action: 'retry',
          todo: target,
          ..._summarize(current)
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
    _sessionPlanPending.delete(sessionId)
  }
  // 有未完成 todo → 保留，不做清理
}

/**
 * 测试用：清空所有会话的 Todo 数据（仅测试代码调用，生产代码勿用）
 */
skill._cleanupAllForTest = function _cleanupAllForTest() {
  _sessionTodos.clear()
  _sessionPlanPending.clear()
}

// 导出 restoreFromSnapshot 供续跑流程直接调用（不经 SkillExecutor，避免要构造 context）
skill.restoreFromSnapshot = restoreFromSnapshot

module.exports = skill
