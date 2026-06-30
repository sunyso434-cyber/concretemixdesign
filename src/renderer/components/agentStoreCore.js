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
    sidebarCollapsed: true,
    // v9.0.0 补充21：欢迎页是否可见（true = 显示欢迎页，false = 显示消息列表）
    // 启动默认 true；新建会话后 true；切到已有会话/发首条消息后 false
    welcomeVisible: true
  },
  // 会话状态缓存：key=sessionId, value={ messages, agent, ts }
  // 用于切换会话时保留后台 agent 的流式输出，支持多会话并行
  sessionsCache: {},
  confirmation: null
}

// sessionsCache LRU 上限（避免内存无限增长）
// 注：原值 20 会导致大对象累积（含 analysisReport/preprocessedData），改为 3 控内存
const SESSIONS_CACHE_LIMIT = 3

export function mergeReplyToMessages(messages, reply, requestId, timeline, stopReason) {
  // 用 `=== true` 严格匹配：历史消息的 _streaming 是 undefined（spec 6.3），
  // 不会被误判为 falsy 跳过；只有当前正在流式输出的消息才是 true
  let idx = -1
  if (requestId) {
    idx = messages.findIndex(m => m._agentRequestId === requestId && m._streaming === true)
  }
  // 无 requestId 或精确匹配失败时，兜底查找任意正在流式输出的 assistant 消息
  if (idx < 0) {
    idx = messages.findIndex(m => m.role === 'assistant' && m._streaming === true)
  }
  if (idx >= 0) {
    const next = [...messages]
    next[idx] = {
      role: 'assistant',
      content: reply || '',
      _agentRequestId: requestId || next[idx]._agentRequestId,
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
    case 'PREPEND_MESSAGES': {
      // v9.1.0 新增：分页加载更早的历史消息，拼接到列表头部
      // 后端 getHistory 返回按时间正序排列的消息，直接前置即可
      const existingIds = new Set(state.messages.map(m => m.id).filter(Boolean))
      const newMessages = action.payload.filter(m => !existingIds.has(m.id))
      return { ...state, messages: [...newMessages, ...state.messages] }
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
    case 'SET_WELCOME_VISIBLE': {
      // v9.0.0 补充21：切换欢迎页/消息列表显隐
      return { ...state, session: { ...state.session, welcomeVisible: action.payload } }
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
    case 'CACHE_SESSION': {
      // 切出当前会话：把当前 messages + agent 快照存入 sessionsCache
      // ⚠️ 精简副本：只保留 role/content/timeline/stopReason 等必要字段，
      //    丢弃 analysisReport/preprocessedData/materialPicker 等大对象（切回时从 DB 重新加载）
      const sid = action.payload?.sessionId || state.session.currentId
      if (!sid) return state
      const slimMessages = state.messages.map(m => ({
        role: m.role,
        content: m.content,
        timeline: m.timeline,
        stopReason: m.stopReason,
        _streaming: m._streaming,
        _agentRequestId: m._agentRequestId,
        type: m.type,
        classifiedError: m.classifiedError
      }))
      const newCache = {
        ...state.sessionsCache,
        [sid]: {
          messages: slimMessages,
          agent: state.agent,
          ts: Date.now()
        }
      }
      // LRU 淘汰：超过上限删除最旧的
      const keys = Object.keys(newCache)
      if (keys.length > SESSIONS_CACHE_LIMIT) {
        keys.sort((a, b) => newCache[a].ts - newCache[b].ts)
        for (let i = 0; i < keys.length - SESSIONS_CACHE_LIMIT; i++) {
          delete newCache[keys[i]]
        }
      }
      return { ...state, sessionsCache: newCache }
    }
    case 'RESTORE_SESSION': {
      // 切入目标会话：从 sessionsCache 恢复 messages + agent
      const sid = action.payload?.sessionId
      if (!sid) return state
      const cached = state.sessionsCache[sid]
      if (cached) {
        let messages = cached.messages || []
        // 若恢复时后台仍在流式输出，把已累积的 replyText 写回流式占位消息，
        // 保留 _streaming=true，确保切回后继续追加新 token
        if (
          cached.agent?.replyText &&
          (cached.agent.status === 'streaming' || cached.agent.status === 'thinking')
        ) {
          messages = messages.map(m =>
            m.role === 'assistant' && m._streaming
              ? { ...m, content: cached.agent.replyText }
              : m
          )
        }
        return {
          ...state,
          messages,
          agent: cached.agent || initialState.agent,
          session: { ...state.session, currentId: sid }
        }
      }
      // 无缓存：清空 state，让 switchSession 走 DB 加载流程
      return {
        ...state,
        messages: [],
        agent: { ...initialState.agent, runMode: state.agent.runMode },
        session: { ...state.session, currentId: sid }
      }
    }
    case 'BACKGROUND_UPDATE': {
      // 后台会话事件：更新 sessionsCache 中目标会话的 messages/agent
      const { sessionId, messages, agent } = action.payload || {}
      if (!sessionId) return state
      const existing = state.sessionsCache[sessionId]
      if (!existing) {
        // 缓存里没有该会话，可能是会话已被 LRU 淘汰或未缓存过，忽略
        return state
      }

      let updatedAgent = existing.agent
      let updatedMessages = existing.messages

      if (agent) {
        // text_delta：增量追加 replyText（后台持续累积，避免切回时丢失已生成内容）
        if (agent._deltaText !== undefined) {
          updatedAgent = {
            ...existing.agent,
            replyText: (existing.agent.replyText || '') + agent._deltaText
          }
        } else {
          updatedAgent = { ...existing.agent, ...agent }
        }
      }

      // 后台会话完成：把最终回复合并到缓存的 messages 里
      if (updatedAgent.status === 'done' && updatedAgent.replyText) {
        updatedMessages = mergeReplyToMessages(
          updatedMessages,
          updatedAgent.replyText,
          updatedAgent.requestId,
          updatedAgent.timeline || [],
          null
        )
      }

      const updated = {
        ...existing,
        messages: messages !== undefined ? messages : updatedMessages,
        agent: updatedAgent,
        ts: Date.now()
      }
      return {
        ...state,
        sessionsCache: { ...state.sessionsCache, [sessionId]: updated }
      }
    }
    default:
      return state
  }
}
