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
 * @param {Array} [args.attachments] - 图片附件数组 [{ type, base64, originalName, sizeKB, width, height }]
 */
export async function sendMessage({ dispatch, sessionId, message: userMessage, runMode, attachments }) {
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
  const imageAttachments = (attachments && attachments.length > 0)
    ? attachments.map(a => ({
        type: a.type, key: a.key, originalName: a.originalName,
        sizeKB: a.sizeKB, width: a.width, height: a.height, base64: a.base64
      }))
    : undefined
  dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: userMessage, attachments: imageAttachments } })

  // 4. 插入 assistant 占位消息（mergeReplyToMessages 依赖此消息定位流式内容）
  dispatch({
    type: 'ADD_MESSAGE',
    payload: { role: 'assistant', content: '', _streaming: true, _agentRequestId: requestId }
  })

  // 5. 保存用户消息
  try {
    await window.electronAPI.invoke('agent:saveMessage', {
      sessionId: effectiveSessionId, role: 'user', content: userMessage, stopReason: null,
      attachments: (attachments && attachments.length > 0) ? attachments.map(a => ({
        type: a.type, originalName: a.originalName, sizeKB: a.sizeKB,
        width: a.width, height: a.height, base64: a.base64
      })) : undefined
    })
  } catch (e) {
    console.error('[AgentChat] ❌ 保存用户消息失败:', e)
    // 不阻塞发送（spec 4.1）
  }

  // 6. 调用 agent:run（必须 try/catch，spec 4.1）
  try {
    console.log('[AgentChat] ⏳ 等待 agent:run 返回...', { requestId })
    const r = await window.electronAPI.invoke('agent:run', {
      requestId, sessionId: effectiveSessionId, message: userMessage, mode: runMode, attachments: attachments || []
    })
    console.log('[AgentChat] 📨 agent:run 返回', { requestId, success: r?.success, resultSuccess: r?.result?.success, error: r?.result?.error })

    // agent:run 返回格式：成功时 { success: true, result: {...} }，失败时 { success: false, error: {...} }
    if (r && r.result && r.result.success === false) {
      // 业务层错误（r.result.error 为结构化错误对象）
      const err = r.result.error || {}
      dispatch({ type: 'ERROR', payload: { classifiedError: err, sessionId: effectiveSessionId, requestId } })
      // toast 提示用户
      const toastText = err.title ? `[${err.code || 'ERROR'}] ${err.title}${err.hint ? ' — ' + err.hint : ''}` : 'AI 执行失败'
      message.error(toastText)
    } else if (r && r.success === false) {
      // 通信层错误（r.error 为结构化错误对象）
      const err = r.error || {}
      dispatch({ type: 'ERROR', payload: { classifiedError: err, sessionId: effectiveSessionId, requestId } })
      const toastText = err.title ? `[${err.code || 'ERROR'}] ${err.title}${err.hint ? ' — ' + err.hint : ''}` : 'AI 执行失败'
      message.error(toastText)
    }
  } catch (e) {
    console.error('[AgentChat] 💥 agent:run 异常', { requestId, error: e.message })
    const errMsg = e.message || '未知错误'
    dispatch({ type: 'ERROR', payload: { classifiedError: { code: 'EXCEPTION', title: errMsg }, sessionId: effectiveSessionId, requestId } })
    message.error(`AI 执行异常 — ${errMsg}`)
  }
}

/**
 * v0.6.2 插话按时序显示：
 * 1. 封存当前 streaming 的 AI 气泡（replyText/timeline 固化，作为「插话前」段落）
 * 2. 插入插话消息（带 _steer / _steerImmediate 标签）
 * 3. 新开一个 AI 占位气泡，承接 AI 对插话的回答（DONE 时 merge 到这里，显示在插话下方）
 *
 * 这样插话后的回答永远出现在插话消息之后，用户不会把「悬在末尾的插话」误认为没被响应。
 *
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} args.msg - 插话内容
 * @param {string} args.requestId - 当前 agent 请求 ID（新气泡沿用，DONE 时 mergeReplyToMessages 定位用）
 * @param {string} args.flag - '_steer'（Enter 排队）| '_steerImmediate'（Alt+Enter 立即）
 */
export function insertSteerMessage({ dispatch, msg, requestId, flag }) {
  // 1. 封存当前 AI 气泡（无内容则移除空气泡，同时清空 replyText/timeline）
  dispatch({ type: 'SEAL_STREAMING_MESSAGE' })
  // 2. 插入插话消息
  dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: msg, [flag]: true } })
  // 3. 新开 AI 占位气泡
  dispatch({ type: 'ADD_MESSAGE', payload: { role: 'assistant', content: '', _streaming: true, _agentRequestId: requestId } })
}

/**
 * 停止 Agent（spec 7.2）
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} [args.requestId] - 当前请求 ID（用于后端终止）
 * @param {string} [args.sessionId] - 当前会话 ID（多会话并行时按 sessionId 路由 abort）
 */
export function abortAgent({ dispatch, requestId, sessionId }) {
  if (requestId) {
    window.electronAPI.invoke('agent:abort', { requestId, sessionId }).catch(() => {})
  }
  dispatch({ type: 'ABORT' })
}

/**
 * P0 断点续跑（Task 1.6）：检测崩溃窗口（纯 IPC，不含弹窗逻辑）
 *
 * @param {string} sessionId - 当前会话 ID
 * @returns {Promise<{needAsk:boolean, unpairedToolCalls:Array}>}
 */
export async function detectCrashWindow(sessionId) {
  if (!sessionId) return { needAsk: false, unpairedToolCalls: [] }
  try {
    const r = await window.electronAPI.invoke('agent:detect-crash-window', { sessionId })
    if (r && r.success) {
      return { needAsk: !!r.needAsk, unpairedToolCalls: r.unpairedToolCalls || [] }
    }
  } catch (e) {
    console.error('[AgentChat] detect-crash-window 失败:', e)
  }
  return { needAsk: false, unpairedToolCalls: [] }
}

/**
 * P0 断点续跑（Task 1.6）：串行重跑未配对 tool_calls（纯 IPC）
 *
 * @param {string} sessionId
 * @param {Array} unpairedToolCalls - detectCrashWindow 返回的未配对 tool_calls
 * @returns {Promise<Array>} 执行结果
 */
export async function rerunUnpairedTools(sessionId, unpairedToolCalls) {
  if (!sessionId || !Array.isArray(unpairedToolCalls) || unpairedToolCalls.length === 0) {
    return []
  }
  try {
    const r = await window.electronAPI.invoke('agent:rerun-unpaired-tools', {
      sessionId,
      unpairedToolCalls
    })
    return (r && r.results) || []
  } catch (e) {
    console.error('[AgentChat] rerun-unpaired-tools 失败:', e)
    return []
  }
}

/**
 * P0 断点续跑（Task 1.6）：从断点续跑（纯 IPC，不含弹窗逻辑）
 *
 * 弹窗逻辑由 SmartDesignChat.jsx 组件处理（组件已有 Modal import）。
 * 流程：组件调 detectCrashWindow → 若 needAsk 弹窗 → rerunUnpairedTools → resumeFromCheckpoint
 *
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 * @param {string} args.sessionId - 当前会话 ID
 */
export async function resumeFromCheckpoint({ dispatch, sessionId }) {
  if (!sessionId) {
    message.error('无法续跑：缺少会话 ID')
    return
  }

  const requestId = 'resume-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  console.log('[AgentChat] 🔄 resumeFromCheckpoint', { sessionId, requestId })

  // 重置 Agent 状态（复用 SEND_MESSAGE）
  dispatch({ type: 'SEND_MESSAGE', payload: { requestId } })

  // 插入 assistant 占位消息（流式内容定位用）
  dispatch({
    type: 'ADD_MESSAGE',
    payload: { role: 'assistant', content: '', _streaming: true, _agentRequestId: requestId, _resume: true }
  })

  try {
    console.log('[AgentChat] ⏳ 等待 agent:resume-from-checkpoint 返回...', { requestId })
    const r = await window.electronAPI.invoke('agent:resume-from-checkpoint', {
      requestId,
      sessionId
    })
    console.log('[AgentChat] 📨 resume-from-checkpoint 返回', { requestId, success: r?.success })

    if (r && r.result && r.result.success === false) {
      const err = r.result.error || {}
      dispatch({ type: 'ERROR', payload: { classifiedError: err, sessionId, requestId } })
      message.error(err.title ? `[${err.code || 'ERROR'}] ${err.title}` : '续跑失败')
    } else if (r && r.success === false) {
      const err = r.error || {}
      dispatch({ type: 'ERROR', payload: { classifiedError: err, sessionId, requestId } })
      message.error(err.title ? `[${err.code || 'ERROR'}] ${err.title}` : '续跑失败')
    } else {
      message.success('已从断点继续执行')
    }
  } catch (e) {
    console.error('[AgentChat] 💥 resume-from-checkpoint 异常', { requestId, error: e.message })
    dispatch({ type: 'ERROR', payload: { classifiedError: { code: 'EXCEPTION', title: e.message }, sessionId, requestId } })
    message.error(`续跑异常 — ${e.message}`)
  }
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
// 模块级竞态 token：每次 switchSession 递增，IPC 完成后对比 token，避免旧请求覆盖新会话状态
let _switchToken = 0

export async function switchSession({ dispatch, sessionId, state }) {
  const myToken = ++_switchToken

  // 1. 切出当前会话：把当前 messages + agent 快照存入 sessionsCache（不打断后台 agent）
  const currentId = state?.session?.currentId
  if (currentId && currentId !== sessionId) {
    dispatch({ type: 'CACHE_SESSION', payload: { sessionId: currentId } })
  }

  // 2. 切入目标会话：优先从 sessionsCache 恢复（保留后台 agent 流式状态）
  //    无缓存则进入空状态，由下面 DB 加载流程填充
  dispatch({ type: 'RESTORE_SESSION', payload: { sessionId } })
  // v9.0.0 补充21：切到已有会话 → 隐藏欢迎页
  dispatch({ type: 'SET_WELCOME_VISIBLE', payload: false })

  // 3. 如果 RESTORE_SESSION 恢复了缓存（messages 非空），跳过 DB 加载，避免覆盖后台流式状态
  //    缓存命中判定：恢复后 state.messages.length > 0
  //    注意：RESTORE_SESSION 是同步 reducer，下一个 dispatch 周期即可读取
  //    这里用 await Promise.resolve() 让 reducer 先应用，再通过 dispatch 闭包读取最新状态
  await Promise.resolve()

  // 切换工作区（与消息加载解耦）
  try {
    const sessionInfo = await window.electronAPI.invoke('agent:getSessionInfo', { sessionId }).catch(() => null)
    dispatch({ type: 'SET_SESSION_ARCHIVED', payload: !!sessionInfo?.archived })

    if (sessionInfo && sessionInfo.workspacePath) {
      try {
        const currentWorkspace = await window.electronAPI.workspace.current()
        const currentPath = currentWorkspace?.path?.replace(/\\/g, '/') || null
        const targetPath = sessionInfo.workspacePath.replace(/\\/g, '/')

        if (currentPath !== targetPath) {
          console.log('[switchSession] 切换工作区:', targetPath)
          await window.electronAPI.workspace.open(targetPath)
        }
      } catch (wsErr) {
        console.warn('[switchSession] 工作区切换失败（不阻塞消息加载）:', wsErr?.message || wsErr)
      }
    }
  } catch (e) {
    // workspace 切换整体失败不阻塞
  }

  // 4. 从 DB 加载消息（仅当缓存未命中时）
  //    缓存命中时跳过，避免覆盖后台 agent 的流式输出
  //    通过查询 state.sessionsCache[sessionId] 是否存在且 messages 非空判断
  //    注意：这里通过 dispatch 一个特殊 action 来读取最新 state 不优雅，
  //    改为直接调用 IPC 加载，加载后由调用方根据 state 决定是否 SET_MESSAGES
  //    简化方案：调用方传入 getState 函数
  try {
    const r = await window.electronAPI.invoke('agent:getSessionMessages', { sessionId })
    if (myToken !== _switchToken) {
      console.log('[switchSession] 已被新会话切换抢占，放弃本次消息加载')
      return
    }
    if (r && r.messages && r.messages.length > 0) {
      // 仅在当前 state.messages 为空时才覆盖（避免覆盖缓存中的后台流式状态）
      // 调用方需传入最新 state，否则总是覆盖（降级为旧行为）
      const currentMessages = state?.messages || []
      if (currentMessages.length === 0) {
        dispatch({
          type: 'SET_MESSAGES',
          payload: r.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolCalls: m.toolCalls,
            timeline: (m.metadata && m.metadata.timeline) || [],
            stopReason: m.stopReason || null,
            createdAt: m.createdAt
          }))
        })
      }
    }
  } catch (e) {
    console.error('[switchSession] 加载会话消息失败:', e)
  }
}

/**
 * 加载更多历史消息（分页，v9.1.0）
 * @param {Object} args
 * @param {Function} args.dispatch
 * @param {string} args.sessionId
 * @param {Array} args.messages - 当前已加载的消息列表
 * @returns {Promise<{loaded: number, hasMore: boolean}>}
 */
export async function loadMoreSessionMessages({ dispatch, sessionId, messages }) {
  if (!sessionId || !messages || messages.length === 0) {
    return { loaded: 0, hasMore: false }
  }
  // 找到当前最早一条消息的时间作为分页游标
  const oldest = messages.reduce((acc, m) => {
    const t = m.createdAt || m.timestamp
    if (!t) return acc
    return !acc || new Date(t) < new Date(acc) ? t : acc
  }, null)
  if (!oldest) {
    return { loaded: 0, hasMore: false }
  }
  try {
    const r = await window.electronAPI.invoke('agent:getSessionMessages', { sessionId, before: oldest })
    if (r && r.messages && r.messages.length > 0) {
      dispatch({
        type: 'PREPEND_MESSAGES',
        payload: r.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          timeline: (m.metadata && m.metadata.timeline) || [],
          stopReason: m.stopReason || null,
          createdAt: m.createdAt
        }))
      })
    }
    return { loaded: (r && r.messages && r.messages.length) || 0, hasMore: (r && r.messages && r.messages.length) >= 20 }
  } catch (e) {
    console.error('[loadMoreSessionMessages] 加载更多消息失败:', e)
    return { loaded: 0, hasMore: false }
  }
}

/**
 * 创建新会话（spec 5.1）
 *
 * v9.0.0 补充21：未发送消息的会话不写库
 * - 旧实现：立即调 agent:createSession IPC 把 ChatSession 记录写入 DB，会话立即出现在侧栏列表中
 * - 新实现：仅在内存中生成 sessionId + 清空 messages + 重置 agent，**不**调 IPC
 *   首条消息发送时由 agent:saveMessage → SessionService.ensureSession 创建 ChatSession 记录
 *   这样用户点 "+" 后没发消息就切换/关闭，该 session 在 DB 中完全不留痕迹
 *
 * @param {Object} args
 * @param {Function} args.dispatch - reducer 的 dispatch
 */
export function createSession({ dispatch }) {
  const newId = newSessionId()
  dispatch({ type: 'SET_SESSION_ID', payload: newId })
  dispatch({ type: 'CLEAR_MESSAGES' })
  dispatch({ type: 'RESET_AGENT' })
  // 不再调 agent:createSession IPC；列表刷新推迟到首条消息发送后（由 sendMessage → saveMessage → sessionUpdated 触发）
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
  const { state, dispatch } = useAgentStore()
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

    // agent 完成后刷新会话列表（此时后端 AI 摘要大概率已生成，可更新标题）
    loadSessionList({ dispatch }).catch(() => {})
  }, [state.agent.status, state.messages, state.agent.requestId, state.session.currentId, state.agent.timeline, dispatch])
}
