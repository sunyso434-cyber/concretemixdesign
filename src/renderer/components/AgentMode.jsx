import { useEffect, useRef } from 'react'
import { message } from 'antd'
import { useAgentStore } from './AgentStore'

/**
 * AgentMode hook - 纯事件监听器。
 * 监听 agent:progress / agent:confirmation-request 事件并 dispatch 到 AgentStore。
 * 所有状态通过 useAgentStore() 读取，不再自维护 state。
 */
export default function useAgentMode() {
  const { state, dispatch } = useAgentStore()
  const agentRequestIdRef = useRef(null)

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
        // v11.7.7: 记录当前路由到的 LLM 模型信息，用户可感知路由状态
        // v0.9.x 输出优化: 附带 usage（token 用量）供统计行展示；
        // 并用真实 prompt_tokens 更新上下文圆环（比字符估算准确，每次任务后刷新）
        case 'model_info':
          dispatch({
            type: 'SET_MODEL_INFO',
            payload: { model: data.model, provider: data.provider, usage: data.usage || null }
          })
          if (data.usage && typeof data.usage.prompt_tokens === 'number') {
            dispatch({
              type: 'SET_CONTEXT_STATS',
              payload: {
                realTokens: data.usage.prompt_tokens,
                // 配置存储可能是字符串（如 "1023999"），统一转数字（圆环分母）
                contextLimit: data.contextLimit !== undefined ? (Number(data.contextLimit) || undefined) : undefined
              }
            })
          }
          return
        case 'model_switching':
          // v0.9.x：failover 切换前告知——时间线留痕（模型X失败原因 + 自动改用Y）
          dispatch({
            type: 'MODEL_SWITCH_NOTICE',
            payload: { from: data.from, to: data.to, reason: data.reason || {} }
          })
          return
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
        case 'context_compacted':
          // 更新上下文统计
          if (data.realTokens) {
            dispatch({
              type: 'SET_CONTEXT_STATS',
              payload: { realTokens: data.realTokens }
            })
          }
          message.success('上下文已自动压缩，释放了对话空间')
          break
        case 'context_stats':
          // v0.9.x 输出优化：上下文构成细分（system/tools/messages）
          // 只更新细分面板；不更新圆环（避免任务开始时的估算值让圆环跳变，
          // 圆环统一用 model_info 的真实 prompt_tokens）
          if (data.breakdown) {
            dispatch({ type: 'SET_CONTEXT_BREAKDOWN', payload: { breakdown: data.breakdown } })
          }
          return
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

    let progressId = null
    try {
      progressId = window.electronAPI?.on?.('agent:progress', onProgress)
    } catch (_) {}

    return () => {
      try {
        if (progressId) window.electronAPI?.removeListener?.(progressId)
      } catch (_) {}
    }
  }, [dispatch, state.agent.requestId, state.session.currentId])

  // v2026-08-03：确认弹窗监听独立挂载（不随 requestId 重建，避免空窗期丢 ask_user 弹窗事件）
  useEffect(() => {
    let confirmId = null
    let closeId = null
    try {
      confirmId = window.electronAPI?.on?.('agent:confirmation-request', (data) => {
        dispatch({ type: 'SET_CONFIRMATION', payload: data })
      })
      closeId = window.electronAPI?.on?.('agent:confirmation-close', () => {
        // 主进程超时/结束时通知收起弹窗（防残留卡住后续提问）
        dispatch({ type: 'SET_CONFIRMATION', payload: null })
      })
    } catch (_) {}
    return () => {
      try {
        if (confirmId) window.electronAPI?.removeListener?.(confirmId)
        if (closeId) window.electronAPI?.removeListener?.(closeId)
      } catch (_) {}
    }
  }, [dispatch])

  return { state, dispatch, agentRequestIdRef }
}
