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
import { useAgentStore } from './AgentStore'

/**
 * 生成 sessionId：时间戳 + 随机后缀，避免快速点击重复
 */
function newSessionId() {
  return 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
}

/**
 * 发送消息（统一入口，spec 4.1）
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} args.sessionId - 当前会话 ID
 * @param {string} args.message - 用户消息
 * @param {string} [args.runMode] - 运行模式 auto | collaborative
 */
export async function sendMessage({ dispatch, sessionId, message, runMode }) {
  if (!message || !message.trim()) return

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

  // 2. 重置 Agent 状态
  dispatch({ type: 'SEND_MESSAGE', payload: { requestId } })

  // 3. 先添加用户消息（确保用户消息在前）
  dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: message } })

  // 4. 插入 assistant 占位消息（mergeReplyToMessages 依赖此消息定位流式内容）
  dispatch({
    type: 'ADD_MESSAGE',
    payload: { role: 'assistant', content: '', _streaming: true, _agentRequestId: requestId }
  })

  // 5. 保存用户消息
  try {
    await window.electronAPI.invoke('agent:saveMessage', {
      sessionId: effectiveSessionId, role: 'user', content: message, stopReason: null
    })
  } catch (e) {
    console.error('保存用户消息失败:', e)
    // 不阻塞发送（spec 4.1）
  }

  // 6. 调用 agent:run（必须 try/catch，spec 4.1）
  try {
    const r = await window.electronAPI.invoke('agent:run', {
      requestId, sessionId: effectiveSessionId, message, mode: runMode
    })
    if (r && r.success === false) {
      dispatch({ type: 'ERROR', payload: { error: r.error || '启动失败' } })
    }
  } catch (e) {
    dispatch({ type: 'ERROR', payload: { error: '通信失败: ' + (e.message || '未知错误') } })
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
