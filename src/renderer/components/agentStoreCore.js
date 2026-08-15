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
  // 上下文上限（主进程 cfg.deepseekContextLimit；SET_CONTEXT_STATS / model_info 更新；UI 分母）
  contextLimit: 200000,
  // v0.9.x 输出优化：上下文构成细分（{ system, tools, messages } token 估算，来自主进程 context_stats 事件）
  contextBreakdown: null,
  agent: {
    status: 'idle',         // idle | thinking | streaming | tool_calling | paused | done | error | aborted
    timeline: [],
    replyText: '',
    requestId: null,
    runMode: 'auto',
    // v11.7.7: 当前路由到的 LLM 信息（provider + model），用户可感知路由状态
    currentModel: '',
    currentProvider: '',
    // v0.9.x 输出优化：本轮 token 用量（model_info 携带）与开始时间（统计行用）
    usage: null,
    startedAt: null
  },
  session: {
    currentId: null,
    list: [],
    sidebarCollapsed: true,
    // v9.0.0 补充21：欢迎页是否可见（true = 显示欢迎页，false = 显示消息列表）
    // 启动默认 true；新建会话后 true；切到已有会话/发首条消息后 false
    welcomeVisible: true,
    // 当前打开会话是否已归档（归档=只读，需恢复后才能续聊）
    currentArchived: false
  },
  // 会话状态缓存：key=sessionId, value={ messages, agent, ts }
  // 用于切换会话时保留后台 agent 的流式输出，支持多会话并行
  sessionsCache: {},
  confirmation: null
}

// sessionsCache LRU 上限（避免内存无限增长）
// 注：原值 20 会导致大对象累积（含 analysisReport/preprocessedData），改为 3 控内存
const SESSIONS_CACHE_LIMIT = 3

export function mergeReplyToMessages(messages, reply, requestId, timeline, stopReason, stats) {
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
      // v0.9.x 输出优化：回合统计（elapsedMs / usage），统计行渲染用；无数据时为 undefined 不展示
      stats,
      _streaming: false
    }
    return next
  }
  // 兜底追加：消息无内存标记（spec 6.3 — 历史消息不存 _streaming/_agentRequestId）
  return [...messages, { role: 'assistant', content: reply || '', timeline, stopReason: stopReason || null, stats }]
}

/**
 * v0.9.x 一致性修复：历史会话 timeline 重建（对齐 DSH——同一数据源、同一渲染路径）
 *
 * 旧版保存的历史会话里，assistant 消息只有 toolCalls（LLM 返回的工具调用），
 * tool 消息单独存 result（content=JSON，toolCallId 与 assistant toolCalls 配对），
 * 但没有 timeline → 加载后工具过程只能以 ToolMessageBubble 显示原始 JSON。
 *
 * 这里在加载时重建 timeline：assistant 的每个 toolCall 生成一个 tool 节点
 * （toolName/args/result/status），与 StreamingAgentCard 实时渲染的结构一致；
 * 被消费的 tool 消息从列表中移除（避免重复显示）。
 */
export function rebuildTimelines(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages

  const result = []
  // 待结算的 assistant（其后的 tool 消息配对给它）
  let pending = null // { msg, toolCalls: [...{tc, matched}] }

  const settlePending = () => {
    if (!pending) return
    const { msg, toolCalls } = pending
    const rebuilt = []
    for (const entry of toolCalls) {
      const tc = entry.tc
      const fn = tc && tc.function ? tc.function : {}
      let args = null
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments || null)
      } catch (_) { args = null }
      rebuilt.push({
        type: 'tool',
        toolName: fn.name || 'unknown',
        args,
        result: entry.matched || null,
        status: 'done',
        toolCallId: tc && tc.id ? tc.id : undefined,
      })
    }
    result.push({ ...msg, timeline: rebuilt, _timelineRebuilt: true })
    pending = null
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m || typeof m !== 'object') {
      settlePending()
      result.push(m)
      continue
    }

    if (m.role === 'assistant') {
      settlePending()
      const hasTimelineTools = Array.isArray(m.timeline) && m.timeline.some(t => t && t.type === 'tool')
      const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : []
      if (!hasTimelineTools && toolCalls.length > 0) {
        // 进入待结算：其后的 tool 消息将按 toolCallId 配对
        pending = { msg: m, toolCalls: toolCalls.map(tc => ({ tc, matched: null })) }
      } else {
        result.push(m)
      }
    } else if (m.role === 'tool') {
      if (pending) {
        // 配对：优先 toolCallId 精确匹配，否则顺序取未匹配的
        let target = null
        if (m.toolCallId) {
          target = pending.toolCalls.find(e => !e.matched && e.tc && e.tc.id === m.toolCallId) || null
        }
        if (!target) {
          target = pending.toolCalls.find(e => !e.matched) || null
        }
        if (target) {
          const raw = m.content
          let parsed = null
          if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw) } catch (_) { parsed = raw }
          } else {
            parsed = raw
          }
          target.matched = parsed
          continue // 已消费：不再单独显示
        }
      }
      result.push(m) // 无 assistant 可配对 → 单独显示（ToolMessageBubble）
    } else {
      settlePending()
      result.push(m)
    }
  }
  settlePending()
  return result
}

/**
 * v0.9.x 一致性修复：新旧对话渲染统一（对齐 DSH 的做法——同一渲染路径）
 *
 * 新对话运行中，工具调用展示在 assistant 消息的 timeline（StreamingAgentCard 工具块）；
 * 旧会话加载时，同一条工具调用还有独立的 role='tool' 消息（ToolMessageBubble），
 * 导致同一工具调用重复显示且样式不一致。
 *
 * 规则：若某条 role='tool' 消息之前最近的 assistant 消息 timeline 已含工具节点，
 * 则隐藏该 tool 消息（已在 timeline 中展示）；老会话（timeline 无工具节点）
 * 保留 tool 消息（由升级后的 ToolMessageBubble 结构化展示）。
 */
export function dedupeToolMessages(messages) {
  if (!Array.isArray(messages)) return messages
  let lastAssistantHasToolTimeline = false
  const out = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') {
      out.push(m)
      continue
    }
    if (m.role === 'assistant') {
      const tl = m.timeline || (m.metadata && m.metadata.timeline) || []
      lastAssistantHasToolTimeline = Array.isArray(tl) && tl.some(t => t && t.type === 'tool')
      out.push(m)
    } else if (m.role === 'tool') {
      // 已在 assistant timeline 展示过 → 隐藏，避免重复
      if (!lastAssistantHasToolTimeline) out.push(m)
    } else {
      // user 消息 = 新轮次开始，重置状态
      if (m.role === 'user') lastAssistantHasToolTimeline = false
      out.push(m)
    }
  }
  return out
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
          requestId: action.payload.requestId,
          usage: null,
          startedAt: Date.now()   // v0.9.x 输出优化：记录本轮开始时刻，统计行算总耗时
        }
      }
    }
    case 'ADD_MESSAGE': {
      return { ...state, messages: [...state.messages, action.payload] }
    }
    case 'SEAL_STREAMING_MESSAGE': {
      // v0.6.2 插话按时序显示：封存当前 streaming 的 AI 气泡（content+timeline 固化，
      // _streaming 置 false），并清空 replyText/timeline，让插话后的回答从空开始累积，
      // DONE 时 mergeReplyToMessages 会定位到新气泡（显示在插话下方）。
      // 若 AI 还没输出任何内容（replyText 和 timeline 都空），直接移除空气泡，不显示空白段落。
      const { replyText, timeline } = state.agent
      const hasContent = (replyText || '').trim().length > 0 || (Array.isArray(timeline) && timeline.length > 0)
      const idx = state.messages.findIndex(m => m.role === 'assistant' && m._streaming === true)
      let messages = state.messages
      if (idx >= 0) {
        if (hasContent) {
          messages = messages.map((m, i) =>
            i === idx
              ? { ...m, content: replyText || '', timeline, _streaming: false, _sealed: true, stopReason: 'sealed' }
              : m
          )
        } else {
          messages = messages.filter((_, i) => i !== idx)
        }
      }
      return {
        ...state,
        messages,
        agent: { ...state.agent, replyText: '', timeline: [] }
      }
    }
    case 'SET_MESSAGES': {
      // P3 commit 2 修复：保留所有字段（含 streaming / streamId / toolEvents / _dedupKey / classifiedError 等），
      // 仅规范化 timeline 和 stopReason 默认值。
      // 历史消息加载时的字段剥离由调用方（agentActions.js）在 dispatch 前完成。
      // v0.9.x：先重建历史 timeline（旧会话 toolCalls+tool 消息 → 工具时间线），
      // 再按"timeline 已含工具块则隐藏重复 tool 消息"去重，统一新旧对话渲染
      const rebuilt = rebuildTimelines(action.payload)
      const deduped = dedupeToolMessages(rebuilt)
      const clean = deduped.map(m => ({
        ...m,
        timeline: m.timeline || m.metadata?.timeline || [],
        stopReason: m.stopReason || null,
        // v0.9.x 输出优化：历史消息还原统计行数据（metadata.usage 由 useAssistantPersistence 落库）
        stats: m.stats || (m.metadata?.usage ? { usage: m.metadata.usage } : undefined)
      }))
      return { ...state, messages: clean }
    }
    case 'UPDATE_MESSAGE_ID': {
      // v0.9.x 输出优化：assistant 消息落库后回写 DB id（赞/踩反馈依赖 messageId）
      const { requestId, id } = action.payload || {}
      if (!id) return state
      const messages = state.messages.map(m =>
        m._agentRequestId === requestId && m.role === 'assistant' && !m.id
          ? { ...m, id }
          : m
      )
      return { ...state, messages }
    }
    case 'PREPEND_MESSAGES': {
      // v9.1.0 新增：分页加载更早的历史消息，拼接到列表头部
      // 后端 getHistory 返回按时间正序排列的消息，直接前置即可
      // v0.9.x：合并后同样重建 timeline + 去重，避免分页边界重复显示
      const existingIds = new Set(state.messages.map(m => m.id).filter(Boolean))
      const newMessages = action.payload.filter(m => !existingIds.has(m.id))
      return { ...state, messages: dedupeToolMessages(rebuildTimelines([...newMessages, ...state.messages])) }
    }
    case 'CLEAR_MESSAGES': {
      // v8.4.2：清空消息时同步重置 contextRealTokens，避免新对话污染
      return { ...state, messages: [], contextRealTokens: 0 }
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
    case 'SET_TODOS': {
      // Layer 3 状态保留：压缩上下文后恢复未完成 todo
      return {
        ...state,
        todos: action.payload
      }
    }
    case 'SET_CONTEXT_STATS': {
      // v8.4.2：支持同时更新 contextLimit；不传时保持原值
      return {
        ...state,
        contextRealTokens: action.payload.realTokens || 0,
        contextLimit: action.payload.contextLimit || state.contextLimit
      }
    }
    case 'SET_CONTEXT_BREAKDOWN': {
      // v0.9.x 输出优化：上下文构成细分（system/tools/messages），供圆环点击细分面板展示
      const b = action.payload && action.payload.breakdown
      return {
        ...state,
        contextBreakdown: b && typeof b === 'object' ? b : state.contextBreakdown
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
            status: 'running', collapsed: true,
            startedAt: Date.now()   // v0.9.x 轨迹阶段2：工具开始时刻（算每步耗时）
          }]
        }
      }
    }
    case 'TOOL_DONE': {
      const timeline = state.agent.timeline.map(item =>
        item.type === 'tool' && item.toolCallId === action.payload.toolCallId
          ? {
              ...item, status: 'done', result: action.payload.result,
              // v0.9.x 轨迹阶段2：每步精确耗时（无 startedAt 的旧数据为 null）
              elapsedMs: item.startedAt ? Date.now() - item.startedAt : null
            }
          : item
      )
      return { ...state, agent: { ...state.agent, status: 'streaming', timeline } }
    }
    case 'TOOL_ERROR': {
      const timeline = state.agent.timeline.map(item =>
        item.type === 'tool' && item.toolCallId === action.payload.toolCallId
          ? {
              ...item, status: 'error', error: action.payload.error,
              elapsedMs: item.startedAt ? Date.now() - item.startedAt : null
            }
          : item
      )
      return { ...state, agent: { ...state.agent, timeline } }
    }
    case 'DONE': {
      const reply = action.payload.reply || state.agent.replyText
      const elapsedMs = state.agent.startedAt ? Date.now() - state.agent.startedAt : null
      const updatedMessages = mergeReplyToMessages(
        state.messages, reply, state.agent.requestId, state.agent.timeline, null,
        { elapsedMs, usage: state.agent.usage }
      )
      return {
        ...state,
        agent: { ...state.agent, status: 'done', replyText: '' },
        messages: updatedMessages
      }
    }
    case 'ABORT': {
      const elapsedMs = state.agent.startedAt ? Date.now() - state.agent.startedAt : null
      const updatedMessages = mergeReplyToMessages(
        state.messages, state.agent.replyText, state.agent.requestId,
        state.agent.timeline, 'aborted',
        { elapsedMs, usage: state.agent.usage }
      )
      return {
        ...state,
        agent: { ...state.agent, status: 'aborted', replyText: '' },
        messages: updatedMessages
      }
    }
    case 'PAUSE': {
      // 输出优化：卡内暂停按钮 → 仅运行中可暂停（主进程 controlMixin 同规则）
      if (state.agent.status === 'running' || state.agent.status === 'streaming' || state.agent.status === 'thinking' || state.agent.status === 'tool_calling') {
        return { ...state, agent: { ...state.agent, status: 'paused' } }
      }
      return state
    }
    case 'RESUME': {
      // 输出优化：卡内继续按钮 → 仅暂停中可恢复
      if (state.agent.status === 'paused') {
        return { ...state, agent: { ...state.agent, status: 'running' } }
      }
      return state
    }
    case 'ERROR': {
      const { classifiedError, sessionId, requestId } = action.payload || {}
      const dupKey = `${sessionId}::${requestId}::${classifiedError?.code}`

      // 1. 幂等去重：同 (sessionId, requestId, code) 不重复插入错误气泡
      if (Array.isArray(state.messages) && state.messages.some(m => m.type === 'error' && m._dedupKey === dupKey)) {
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
      return { ...state, session: { ...state.session, currentId: action.payload, currentArchived: false } }
    }
    case 'SET_SESSION_ARCHIVED': {
      return { ...state, session: { ...state.session, currentArchived: !!action.payload } }
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
    case 'SET_MODEL_INFO': {
      // v11.7.7: 记录当前路由到的 LLM provider 和 model，让用户可感知路由状态
      // v0.9.x 输出优化：同时记录本轮 token 用量（统计行用）
      return {
        ...state,
        agent: {
          ...state.agent,
          currentModel: action.payload.model || '',
          currentProvider: action.payload.provider || '',
          usage: action.payload.usage || state.agent.usage
        }
      }
    }
    default:
      return state
  }
}
