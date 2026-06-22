/**
 * 共享的 Agent 业务函数 + 副作用 hook（spec 4.1 + 7.2）
 * - sendMessage / abortAgent / loadSessionList / switchSession / createSession
 * - useAssistantPersistence: 监听 agent.status 变化自动持久化到 DB
 *
 * 导出风格：ESM（export const/function）
 * - Vite/React 端用 `import { ... } from './agentActions'`
 * - Jest 端通过 babel-jest (babel.config.js) 自动转 CJS
 */

import { useEffect, useRef } from 'react'
import { message } from 'antd'
import { useAgentStore } from './AgentStore'

/**
 * 将后端错误码转换为用户友好的提示信息
 */
function getFriendlyError(errorCode) {
  const errorMap = {
    'max_failures_exceeded': 'AI 连续响应失败，请稍后重试',
    'max_steps_exceeded': 'AI 执行步骤过多，请简化需求后重试',
    'aborted': '任务已取消',
    'wc_destroyed': '窗口已关闭',
  }
  return errorMap[errorCode] || errorCode || '未知错误'
}

/**
 * 生成 sessionId：时间戳 + 随机后缀，避免快速点击重复
 */
function newSessionId() {
  return 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
}

/**
 * 发送消息（统一入口，spec 4.1）
 *
 * ⚠️ 注意：入参解构时把 `message` 改名为 `userMessage`，避免与 antd 的
 * `import { message } from 'antd'` 在 minify 后产生变量 shadowing bug
 * （曾导致 `t.error is not a function` unhandled promise rejection）。
 * 对外 API 不变：调用方仍传 `{ message: '...' }`。
 *
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} args.sessionId - 当前会话 ID
 * @param {string} args.message - 用户消息
 * @param {string} [args.runMode] - 运行模式 auto | collaborative
 */
export async function sendMessage({ dispatch, sessionId, message: userMessage, runMode }) {
  if (!userMessage || !userMessage.trim()) return

  // 0. 确保 sessionId 有效（如果为空，创建新会话）
  let effectiveSessionId = sessionId
  if (!effectiveSessionId) {
    effectiveSessionId = newSessionId()
    dispatch({ type: 'SET_SESSION_ID', payload: effectiveSessionId })
    // 刷新会话列表
    loadSessionList({ dispatch }).catch(() => {})
  }

  // 1. 生成 requestId
  const requestId = 'agent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)

  // [DEBUG] 记录发送消息
  console.log('[AgentChat] 📤 发送消息', { requestId, sessionId: effectiveSessionId, messageLen: userMessage.length, runMode })

  // 2. 重置 Agent 状态
  dispatch({ type: 'SEND_MESSAGE', payload: { requestId } })

  // 3. 先添加用户消息（确保用户消息在前）
  dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: userMessage } })

  // 4. 插入 assistant 占位消息（mergeReplyToMessages 依赖此消息定位流式内容）
  dispatch({
    type: 'ADD_MESSAGE',
    payload: { role: 'assistant', content: '', _streaming: true, _agentRequestId: requestId }
  })

  // 5. 保存用户消息
  try {
    await window.electronAPI.invoke('agent:saveMessage', {
      sessionId: effectiveSessionId, role: 'user', content: userMessage, stopReason: null
    })
  } catch (e) {
    console.error('[AgentChat] ❌ 保存用户消息失败:', e)
    // 不阻塞发送（spec 4.1）
  }

  // 6. 调用 agent:run（必须 try/catch，spec 4.1）
  try {
    console.log('[AgentChat] ⏳ 等待 agent:run 返回...', { requestId })
    const r = await window.electronAPI.invoke('agent:run', {
      requestId, sessionId: effectiveSessionId, message: userMessage, mode: runMode
    })
    console.log('[AgentChat] 📨 agent:run 返回', { requestId, success: r?.success, resultSuccess: r?.result?.success, error: r?.result?.error })

    // 注意：agent:run 外层总是 { success: true, result }，真正的错误在 result 中
    if (r && r.success === true && r.result && r.result.success === false) {
      const errorMsg = r.result.error || '启动失败'
      const friendlyMsg = getFriendlyError(errorMsg)
      dispatch({ type: 'ERROR', payload: { error: friendlyMsg } })
      message.error(friendlyMsg)
    } else if (r && r.success === false) {
      // 兜底：外层 success=false（通信层面错误）
      dispatch({ type: 'ERROR', payload: { error: r.error || '启动失败' } })
      message.error(r.error || '启动失败，请稍候重试')
    }
  } catch (e) {
    console.error('[AgentChat] 💥 agent:run 异常', { requestId, error: e.message })
    dispatch({ type: 'ERROR', payload: { error: '通信失败: ' + (e.message || '未知错误') } })
    message.error('通信失败: ' + (e.message || '未知错误'))
  }
}

/**
 * 停止 Agent（spec 7.2）
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} [args.requestId] - 当前请求 ID（用于后端终止）
 */
export function abortAgent({ dispatch, requestId }) {
  if (requestId) {
    window.electronAPI.invoke('agent:abort', { requestId }).catch(() => {})
  }
  dispatch({ type: 'ABORT' })
}

/**
 * 加载会话列表（spec 5.3 修复 — 不覆盖 currentId）
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @returns {Promise<Array>} 会话列表
 */
export async function loadSessionList({ dispatch }) {
  try {
    const r = await window.electronAPI.invoke('agent:listSessions')
    if (r && r.sessions) {
      dispatch({ type: 'SET_SESSION_LIST', payload: r.sessions })
    }
    return (r && r.sessions) || []
  } catch (e) {
    console.error('加载会话列表失败:', e)
    return []
  }
}

/**
 * 切换会话（spec 5.2）
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} args.sessionId - 目标会话 ID
 */
export async function switchSession({ dispatch, sessionId }) {
  dispatch({ type: 'RESET_AGENT' })

  try {
    // 1. 获取目标会话的信息（包括 workspacePath）
    const sessionInfo = await window.electronAPI.invoke('agent:getSessionInfo', { sessionId })

    if (sessionInfo && sessionInfo.workspacePath) {
      // 2. 获取当前工作区
      const currentWorkspace = await window.electronAPI.workspace.current()
      const currentPath = currentWorkspace?.path?.replace(/\\/g, '/') || null
      const targetPath = sessionInfo.workspacePath.replace(/\\/g, '/')

      // 3. 如果工作区不同，切换工作区
      if (currentPath !== targetPath) {
        console.log('[switchSession] 切换工作区:', targetPath)
        await window.electronAPI.workspace.open(targetPath)
      }
    }

    // 4. 加载会话消息
    const r = await window.electronAPI.invoke('agent:getSessionMessages', { sessionId })
    if (r && r.messages) {
      dispatch({
        type: 'SET_MESSAGES',
        payload: r.messages.map(m => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          timeline: (m.metadata && m.metadata.timeline) || [],
          stopReason: m.stopReason || null
        }))
      })
    }
  } catch (e) {
    console.error('加载会话消息失败:', e)
    // IPC 失败仍然切换 sessionId，让 UI 进入"空消息"状态
  }
  dispatch({ type: 'SET_SESSION_ID', payload: sessionId })
}

/**
 * 创建新会话（spec 5.1）
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 */
export function createSession({ dispatch }) {
  const newId = newSessionId()
  dispatch({ type: 'SET_SESSION_ID', payload: newId })
  dispatch({ type: 'CLEAR_MESSAGES' })
  dispatch({ type: 'RESET_AGENT' })

  // 立即在数据库中创建 ChatSession 记录，这样会话会立即出现在列表中
  // 默认名称会在用户发送第一条消息时被 AI 摘要覆盖
  window.electronAPI.invoke('agent:createSession', {
    sessionId: newId,
    sessionName: `新对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
  }).catch(err => console.error('创建会话记录失败:', err))

  // loadSessionList 内部已 try/catch，但仍加 .catch 兜底防止未来重构去掉
  loadSessionList({ dispatch }).catch(() => {})
}

/**
 * useAssistantPersistence - 副作用 hook
 * 订阅 state.agent.status 变化，在 done/aborted 时自动持久化 assistant 消息到 DB
 *
 * 必须在 <AgentStoreProvider> 内部调用（一般在 SmartDesignChat 组件内）
 *
 * ⚠️ GUARD 设计要点（关键！老板重点关注）:
 * - 用 useRef 记录"上次的状态"，本次 effect 触发时对比 prev vs curr
 * - 仅在 "工作态 → 终态" 的转移时触发持久化
 *   工作态: thinking / streaming / tool_calling
 *   终态:   done / aborted
 * - guard 缺失会导致:
 *   1. 重复持久化（每次 render 都触发）
 *   2. 状态来回切换时误触发
 *   3. 初始挂载时错误触发（lastStatusRef.current 是 null，不是工作态）
 * - 终态本身不发持久化（done→done 不触发；aborted→aborted 不触发）
 */
export function useAssistantPersistence() {
  const { state } = useAgentStore()
  const lastStatusRef = useRef(null)

  useEffect(() => {
    const prev = lastStatusRef.current
    const curr = state.agent.status
    lastStatusRef.current = curr

    // guard 1: 只在 "工作态 → 终态" 的转移时触发持久化
    const isWorkingState = (s) => s === 'thinking' || s === 'streaming' || s === 'tool_calling'
    const isTerminalState = (s) => s === 'done' || s === 'aborted'
    if (!isWorkingState(prev) || !isTerminalState(curr)) {
      return // 跳过本次 effect
    }

    // guard 2: 用 requestId 找到当前任务对应的 assistant 消息（不被重复 user 消息干扰）
    // 且消息必须已"消流式"（_streaming === false），否则是异常路径
    const targetMsg = state.messages.find(m =>
      m._agentRequestId === state.agent.requestId && !m._streaming
    )
    if (!targetMsg) {
      return // 跳过：没有可持久化的消息
    }

    // guard 3: 跳过空内容（极端情况下 reducer 合并后 content 为空）
    if (!targetMsg.content && curr === 'done') {
      return // 跳过：done 状态但 content 为空（异常路径）
    }

    // 通过所有 guard，触发持久化
    const stopReason = curr === 'aborted' ? 'aborted' : null
    window.electronAPI.invoke('agent:saveMessage', {
      sessionId: state.session.currentId,
      role: 'assistant',
      content: targetMsg.content || '',
      metadata: { timeline: state.agent.timeline },
      stopReason
    }).catch(e => console.error('持久化 assistant 消息失败:', e))
  }, [state.agent.status, state.messages, state.agent.requestId, state.session.currentId, state.agent.timeline])
}
