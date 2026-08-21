// chatSlice — 会话领域状态（优化项 5 新增）
// 会话列表 / 当前会话 / 流式状态。
// 存量组件渐进迁移原则：本 slice 先提供状态模型与 action，组件接入按"触碰哪个迁哪个"推进，
// 不在本阶段做一次性大重写。
import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  // 会话列表（agent:listSessions 结果：{ sessionId, lastActivity, sessionName }[]）
  sessions: [],
  // 当前焦点会话
  currentSessionId: null,
  // 流式状态（按会话记录，跨组件共享给消息列表/统计行/上下文圆环等）
  streaming: {
    sessionId: null,
    isStreaming: false,
    content: '',
  },
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setSessions: (state, action) => {
      state.sessions = action.payload || []
    },
    setCurrentSession: (state, action) => {
      state.currentSessionId = action.payload
    },
    clearCurrentSession: (state) => {
      state.currentSessionId = null
    },
    // 某会话开始流式输出（content 归零）
    streamStarted: (state, action) => {
      state.streaming = { sessionId: action.payload, isStreaming: true, content: '' }
    },
    // 追加流式增量（仅当增量属于当前流式会话，防止多会话并行串流）
    streamDelta: (state, action) => {
      if (state.streaming.sessionId !== action.payload.sessionId) return
      state.streaming.content += action.payload.content
    },
    // 流式结束：保留最终内容但标记结束
    streamEnded: (state) => {
      state.streaming.isStreaming = false
    },
    // 完全重置流式状态
    streamReset: (state) => {
      state.streaming = { sessionId: null, isStreaming: false, content: '' }
    },
  },
})

export const {
  setSessions,
  setCurrentSession,
  clearCurrentSession,
  streamStarted,
  streamDelta,
  streamEnded,
  streamReset,
} = chatSlice.actions
export default chatSlice.reducer