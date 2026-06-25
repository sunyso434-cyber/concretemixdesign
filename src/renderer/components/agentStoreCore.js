/**
 * AgentStore 纯函数核心
 * reducer / mergeReplyToMessages / initialState
 *
 * 重要：此模块严格保持纯函数，不允许任何副作用（IPC、随机、时间戳）
 * 所有副作用下沉到 agentActions.js 的 useAssistantPersistence hook
 *
 * 导出风格：ESM（export const）
 * - Vite/React 端用 `import { ... } from './agentStoreCore'`
 * - Jest 端通过 babel-jest (babel.config.js) 自动转 CJS
 */

export const initialState = {
  messages: [],
  input: '',
  attachment: null,
  contextRealTokens: 0,
  agent: {
    status: 'idle',         // idle | thinking | streaming | tool_calling | done | error | aborted
    timeline: [],
    replyText: '',
    requestId: null,
    runMode: 'auto'
  },
  session: {
    currentId: null,
    list: [],
    sidebarCollapsed: true
  },
  confirmation: null
}

export function mergeReplyToMessages(messages, reply, requestId, timeline, stopReason) {
  // 用 `=== true` 严格匹配：历史消息的 _streaming 是 undefined（spec 6.3），
  // 不会被误判为 falsy 跳过；只有当前正在流式输出的消息才是 true
  const idx = messages.findIndex(m => m._agentRequestId === requestId && m._streaming === true)
  if (idx >= 0) {
    const next = [...messages]
    next[idx] = {
      role: 'assistant',
      content: reply || '',
      _agentRequestId: requestId,
      timeline,
      stopReason: stopReason || null,
      _streaming: false
    }
    return next
  }
  // 兜底追加：消息无内存标记（spec 6.3 — 历史消息不存 _streaming/_agentRequestId）
  return [...messages, { role: 'assistant', content: reply || '', timeline, stopReason: stopReason || null }]
}

export function agentReducer(state, action) {
  switch (action.type) {
    case 'SEND_MESSAGE': {
      return {
        ...state,
        agent: {
          ...state.agent,
          status: 'thinking',
          timeline: [],
          replyText: '',
          requestId: action.payload.requestId
        }
      }
    }
    case 'ADD_MESSAGE': {
      return { ...state, messages: [...state.messages, action.payload] }
    }
    case 'SET_MESSAGES': {
      // P3 commit 2 修复：保留所有字段（含 streaming / streamId / toolEvents / _dedupKey / classifiedError 等），
      // 仅规范化 timeline 和 stopReason 默认值。
      // 历史消息加载时的字段剥离由调用方（agentActions.js）在 dispatch 前完成。
      const clean = action.payload.map(m => ({
        ...m,
        timeline: m.timeline || m.metadata?.timeline || [],
        stopReason: m.stopReason || null
      }))
      return { ...state, messages: clean }
    }
    case 'CLEAR_MESSAGES': {
      return { ...state, messages: [] }
    }
    case 'COMPRESS_MESSAGES': {
      const { summary, recentMessages } = action.payload
      const compactedMessage = {
        role: 'assistant',
        content: summary || '',
        _compacted: true,
        time: { created: Date.now() }
      }
      return {
        ...state,
        messages: [compactedMessage, ...(recentMessages || [])]
      }
    }
    case 'SET_CONTEXT_STATS': {
      return {
        ...state,
        contextRealTokens: action.payload.realTokens || 0
      }
    }
    case 'REASONING_START': {
      return {
        ...state,
        agent: {
          ...state.agent,
          timeline: [...state.agent.timeline, {
            type: 'reasoning', content: '', roundIndex: action.payload.roundIndex,
            status: 'running', collapsed: true
          }]
        }
      }
    }
    case 'REASONING_DELTA': {
      const timeline = [...state.agent.timeline]
      for (let i = timeline.length - 1; i >= 0; i--) {
        if (timeline[i].type === 'reasoning' && timeline[i].status === 'running') {
          timeline[i] = { ...timeline[i], content: timeline[i].content + (action.payload.content || '') }
          break
        }
      }
      return { ...state, agent: { ...state.agent, timeline } }
    }
    case 'REASONING_DONE': {
      const timeline = state.agent.timeline.map(item =>
        item.type === 'reasoning' && item.status === 'running'
          ? { ...item, status: 'done' }
          : item
      )
      return { ...state, agent: { ...state.agent, timeline } }
    }
    case 'TEXT_DELTA': {
      return {
        ...state,
        agent: {
          ...state.agent,
          status: 'streaming',
          replyText: state.agent.replyText + (action.payload.content || '')
        }
      }
    }
    case 'TOOL_START': {
      return {
        ...state,
        agent: {
          ...state.agent,
          status: 'tool_calling',
          timeline: [...state.agent.timeline, {
            type: 'tool', toolCallId: action.payload.toolCallId,
            toolName: action.payload.toolName, args: action.payload.args || {},
            status: 'running', collapsed: true
          }]
        }
      }
    }
    case 'TOOL_DONE': {
      const timeline = state.agent.timeline.map(item =>
        item.type === 'tool' && item.toolCallId === action.payload.toolCallId
          ? { ...item, status: 'done', result: action.payload.result }
          : item
      )
      return { ...state, agent: { ...state.agent, status: 'streaming', timeline } }
    }
    case 'TOOL_ERROR': {
      const timeline = state.agent.timeline.map(item =>
        item.type === 'tool' && item.toolCallId === action.payload.toolCallId
          ? { ...item, status: 'error', error: action.payload.error }
          : item
      )
      return { ...state, agent: { ...state.agent, timeline } }
    }
    case 'DONE': {
      const reply = action.payload.reply || state.agent.replyText
      const updatedMessages = mergeReplyToMessages(
        state.messages, reply, state.agent.requestId, state.agent.timeline, null
      )
      return {
        ...state,
        agent: { ...state.agent, status: 'done', replyText: '' },
        messages: updatedMessages
      }
    }
    case 'ABORT': {
      const updatedMessages = mergeReplyToMessages(
        state.messages, state.agent.replyText, state.agent.requestId,
        state.agent.timeline, 'aborted'
      )
      return {
        ...state,
        agent: { ...state.agent, status: 'aborted', replyText: '' },
        messages: updatedMessages
      }
    }
    case 'ERROR': {
      const { classifiedError, sessionId, requestId } = action.payload || {}
      const dupKey = `${sessionId}::${requestId}::${classifiedError?.code}`

      // 1. 幂等去重：同 (sessionId, requestId, code) 不重复插入错误气泡
      if (state.messages.some(m => m.type === 'error' && m._dedupKey === dupKey)) {
        return { ...state, agent: { ...state.agent, status: 'error' } }
      }

      // 2. 固化流式占位（保留完整 content + timeline，含 reasoning）
      const replyText = state.agent.replyText || ''
      const timeline = state.agent.timeline || []
      let messages = state.messages
      if (replyText.trim() || timeline.length > 0) {
        messages = messages.map(m =>
          m._streaming
            ? { ...m, content: replyText, timeline, stopReason: 'error', _streaming: false }
            : m
        )
      }

      // 3. 追加错误气泡
      messages = [...messages, {
        role: 'system',
        type: 'error',
        classifiedError,
        _dedupKey: dupKey,
        timestamp: Date.now(),
      }]

      return {
        ...state,
        messages,
        agent: { ...state.agent, status: 'error', replyText: '', timeline: [] },
      }
    }
    case 'SET_SESSION_ID': {
      return { ...state, session: { ...state.session, currentId: action.payload } }
    }
    case 'SET_SESSION_LIST': {
      return { ...state, session: { ...state.session, list: action.payload } }
    }
    case 'SET_SIDEBAR_COLLAPSED': {
      return { ...state, session: { ...state.session, sidebarCollapsed: action.payload } }
    }
    case 'SET_RUN_MODE': {
      return { ...state, agent: { ...state.agent, runMode: action.payload } }
    }
    case 'SET_CONFIRMATION': {
      return { ...state, confirmation: action.payload }
    }
    case 'SET_INPUT': {
      return { ...state, input: action.payload }
    }
    case 'RESET_AGENT': {
      return {
        ...state,
        agent: {
          status: 'idle',
          timeline: [],
          replyText: '',
          requestId: null,
          runMode: state.agent.runMode
        }
      }
    }
    default:
      return state
  }
}
