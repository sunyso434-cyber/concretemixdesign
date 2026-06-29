import { useEffect, useRef } from 'react'
import { useAgentStore } from './AgentStore'

/**
 * AgentMode hook - 纯事件监听器。
 * 监听 agent:progress / agent:confirmation-request 事件并 dispatch 到 AgentStore。
 * 所有状态通过 useAgentStore() 读取，不再自维护 state。
 */
export default function useAgentMode() {
  const { state, dispatch } = useAgentStore()
  const agentRequestIdRef = useRef(null)

  // 读取运行模式（应用启动时执行一次，spec 3.1）
  useEffect(() => {
    window.electronAPI.invoke('get-param-by-name', 'agentDefaultMode')
      .then(defaultMode => {
        const runMode = defaultMode?.data?.value
        if (runMode === 'auto' || runMode === 'collaborative') {
          dispatch({ type: 'SET_RUN_MODE', payload: runMode })
        }
      })
      .catch(() => {})
  }, [dispatch])

  // 同步 currentRequestId 到 ref（用于 stop 时获取 requestId）
  useEffect(() => {
    agentRequestIdRef.current = state.agent.requestId
  }, [state.agent.requestId])

  // 监听 agent:progress 事件
  useEffect(() => {
    const onProgress = (data) => {
      const eventType = data.type

      // ===== 多会话并行：按 sessionId 路由事件 =====
      // 前台会话：正常 dispatch 到 state（UI 实时更新）
      // 后台会话：只在 done/error 时 dispatch BACKGROUND_UPDATE（流式过程不 dispatch，避免高频无效更新）
      const eventSessionId = data.sessionId
      // 没有 sessionId 的事件无法判断归属，直接丢弃，防止串流到当前焦点会话
      if (!eventSessionId) return
      const isForeground = eventSessionId === state.session.currentId

      // 后台会话事件：持续写入缓存，避免切回时内容丢失或状态中断
      if (!isForeground) {
        if (eventType === 'text_delta') {
          dispatch({
            type: 'BACKGROUND_UPDATE',
            payload: {
              sessionId: eventSessionId,
              agent: { _deltaText: data.content || '' }
            }
          })
          return
        }
        if (eventType === 'done' || eventType === 'error') {
          dispatch({
            type: 'BACKGROUND_UPDATE',
            payload: {
              sessionId: eventSessionId,
              agent: {
                status: eventType === 'done' ? 'done' : 'error',
                requestId: data.requestId,
                timeline: data.timeline || [],
                replyText: data.result?.reply || ''
              }
            }
          })
        }
        return
      }

      // ===== 前台会话事件：按原逻辑 dispatch =====
      // 事件 requestId 不匹配当前任务则忽略（spec 8.2 锁超时说明）
      if (data.requestId && data.requestId !== state.agent.requestId) {
        return
      }

      switch (eventType) {
        case 'reasoning_start':
          dispatch({ type: 'REASONING_START', payload: { roundIndex: data.roundIndex } })
          return
        case 'reasoning_delta':
          dispatch({ type: 'REASONING_DELTA', payload: { content: data.content } })
          return
        case 'reasoning_done':
          dispatch({ type: 'REASONING_DONE' })
          return
        case 'tool_start':
          dispatch({
            type: 'TOOL_START',
            payload: { toolCallId: data.toolCallId, toolName: data.toolName, args: data.args || {} }
          })
          return
        case 'tool_done':
          dispatch({
            type: 'TOOL_DONE',
            payload: { toolCallId: data.toolCallId, result: data.result }
          })
          return
        case 'tool_error':
          dispatch({
            type: 'TOOL_ERROR',
            payload: { toolCallId: data.toolCallId, error: data.error }
          })
          return
        case 'text_delta':
          dispatch({ type: 'TEXT_DELTA', payload: { content: data.content } })
          return
        case 'done':
          dispatch({ type: 'DONE', payload: { reply: data.result?.reply } })
          return
        case 'error': {
          const { error: classifiedError, sessionId, requestId } = data
          // P3 commit 3: 删除 message.error，去 AI toast
          dispatch({
            type: 'ERROR',
            payload: { classifiedError, sessionId, requestId },
          })
          break
        }
        default:
          // 旧格式兼容（无 type 字段的旧事件）
          if (data.status === 'done' && data.result?.reply) {
            dispatch({ type: 'DONE', payload: { reply: data.result.reply } })
          } else if (data.status === 'error' && data.error && data.error !== 'aborted' && data.error !== 'wc_destroyed') {
            // P3 commit 3: data.error 已是 P2 agentHandler 包装好的结构化对象，直接用
            dispatch({
              type: 'ERROR',
              payload: {
                classifiedError: data.error,
                sessionId: data.sessionId,
                requestId: data.requestId,
              },
            })
          }
      }
    }

    const onConfirmation = (data) => {
      dispatch({ type: 'SET_CONFIRMATION', payload: data })
    }

    let progressId = null
    let confirmId = null
    try {
      progressId = window.electronAPI?.on?.('agent:progress', onProgress)
      confirmId = window.electronAPI?.on?.('agent:confirmation-request', onConfirmation)
    } catch (_) {}

    return () => {
      try {
        if (progressId) window.electronAPI?.removeListener?.(progressId)
        if (confirmId) window.electronAPI?.removeListener?.(confirmId)
      } catch (_) {}
    }
  }, [dispatch, state.agent.requestId, state.session.currentId])

  return { state, dispatch, agentRequestIdRef }
}
