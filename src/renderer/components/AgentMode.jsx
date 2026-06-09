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
          const errorMsg = typeof data.error === 'string' ? data.error
            : data.error?.message || data.error?.error || '未知错误'
          if (errorMsg === 'aborted' || errorMsg === 'wc_destroyed') {
            dispatch({ type: 'ABORT' })
          } else {
            dispatch({ type: 'ERROR', payload: { error: errorMsg } })
          }
          return
        }
        default:
          // 旧格式兼容（无 type 字段的旧事件）
          if (data.status === 'done' && data.result?.reply) {
            dispatch({ type: 'DONE', payload: { reply: data.result.reply } })
          } else if (data.status === 'error' && data.error && data.error !== 'aborted' && data.error !== 'wc_destroyed') {
            const em = typeof data.error === 'string' ? data.error
              : data.error?.message || data.error?.error || '未知错误'
            dispatch({ type: 'ERROR', payload: { error: em } })
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
  }, [dispatch, state.agent.requestId])

  return { state, dispatch, agentRequestIdRef }
}
