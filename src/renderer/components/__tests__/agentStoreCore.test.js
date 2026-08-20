/**
 * agentStoreCore reducer 单元测试
 * 验证 18 个 case：actions / mergeReplyToMessages / 终态不自转 idle
 *
 * 跑法：npx jest src/renderer/components/__tests__/agentStoreCore.test.js
 */

const { agentReducer, mergeReplyToMessages, initialState } = require('../agentStoreCore')

describe('agentReducer', () => {
  test('SEND_MESSAGE 重置 agent 状态 + 设置 requestId', () => {
    const state = { ...initialState, agent: { ...initialState.agent, replyText: 'old' } }
    const next = agentReducer(state, {
      type: 'SEND_MESSAGE',
      payload: { requestId: 'r1' }
    })
    expect(next.agent.status).toBe('thinking')
    expect(next.agent.timeline).toEqual([])
    expect(next.agent.replyText).toBe('')
    expect(next.agent.requestId).toBe('r1')
  })

  test('TEXT_DELTA 累加 replyText + 状态转 streaming', () => {
    const state = { ...initialState, agent: { ...initialState.agent, status: 'thinking' } }
    const next = agentReducer(state, { type: 'TEXT_DELTA', payload: { content: 'hello' } })
    expect(next.agent.status).toBe('streaming')
    expect(next.agent.replyText).toBe('hello')
  })

  test('TOOL_START 追加 timeline + 状态转 tool_calling', () => {
    const state = { ...initialState, agent: { ...initialState.agent, status: 'thinking' } }
    const next = agentReducer(state, {
      type: 'TOOL_START',
      payload: { toolCallId: 'c1', toolName: 'calc', args: {} }
    })
    expect(next.agent.status).toBe('tool_calling')
    expect(next.agent.timeline).toHaveLength(1)
    expect(next.agent.timeline[0].toolCallId).toBe('c1')
  })

  test('REASONING_DELTA 追加到最后一条 reasoning 节点', () => {
    const state = {
      ...initialState,
      agent: { ...initialState.agent, timeline: [{ type: 'reasoning', status: 'running', content: '' }] }
    }
    const next = agentReducer(state, { type: 'REASONING_DELTA', payload: { content: 'x' } })
    expect(next.agent.timeline[0].content).toBe('x')
  })

  test('REASONING_START 追加 reasoning 节点（status=running）', () => {
    const state = initialState
    const next = agentReducer(state, { type: 'REASONING_START', payload: { roundIndex: 0 } })
    expect(next.agent.timeline).toHaveLength(1)
    expect(next.agent.timeline[0]).toMatchObject({
      type: 'reasoning', content: '', status: 'running', roundIndex: 0
    })
  })

  test('REASONING_DONE 把 running 节点标 done', () => {
    const state = {
      ...initialState,
      agent: { ...initialState.agent, timeline: [{ type: 'reasoning', status: 'running', content: 'thinking...' }] }
    }
    const next = agentReducer(state, { type: 'REASONING_DONE' })
    expect(next.agent.timeline[0].status).toBe('done')
    expect(next.agent.timeline[0].content).toBe('thinking...') // 内容保留
  })

  test('DONE 合并 replyText 到流式 assistant 消息（reducer 纯函数，不调 IPC）', () => {
    const state = {
      ...initialState,
      session: { ...initialState.session, currentId: 's1' },
      agent: { ...initialState.agent, replyText: 'hi', requestId: 'r1' },
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r1' }
      ]
    }
    const next = agentReducer(state, { type: 'DONE', payload: { reply: 'hi' } })
    expect(next.agent.status).toBe('done')
    expect(next.messages).toHaveLength(2)
    expect(next.messages[1].content).toBe('hi')
    expect(next.messages[1]._streaming).toBe(false)
    expect(next.agent.replyText).toBe('')
  })

  test('DONE 找不到流式消息时兜底追加（异常路径）', () => {
    const state = {
      ...initialState,
      agent: { ...initialState.agent, replyText: 'hi', requestId: 'r1' },
      messages: [{ role: 'user', content: 'q' }]
    }
    const next = agentReducer(state, { type: 'DONE', payload: { reply: 'hi' } })
    expect(next.messages).toHaveLength(2)
    expect(next.messages[1].content).toBe('hi')
  })

  test('ABORT 合并 replyText + stopReason=aborted', () => {
    const state = {
      ...initialState,
      session: { ...initialState.session, currentId: 's1' },
      agent: { ...initialState.agent, replyText: 'partial', requestId: 'r1' },
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r1' }
      ]
    }
    const next = agentReducer(state, { type: 'ABORT' })
    expect(next.agent.status).toBe('aborted')
    expect(next.messages[1].content).toBe('partial')
    expect(next.messages[1].stopReason).toBe('aborted')
  })

  test('终态（done）不自转 idle', () => {
    const state = { ...initialState, agent: { ...initialState.agent, status: 'done' } }
    const next = agentReducer(state, { type: 'SET_INPUT', payload: 'x' })
    expect(next.agent.status).toBe('done')
  })

  test('SET_SESSION_ID 切换会话 + 不动 session.list', () => {
    const state = { ...initialState, session: { ...initialState.session, list: ['a', 'b'] } }
    const next = agentReducer(state, { type: 'SET_SESSION_ID', payload: 's-new' })
    expect(next.session.currentId).toBe('s-new')
    expect(next.session.list).toEqual(['a', 'b'])
  })

  test('SET_SESSION_LIST 只更新 list 不动 currentId', () => {
    const state = { ...initialState, session: { ...initialState.session, currentId: 's1' } }
    const next = agentReducer(state, { type: 'SET_SESSION_LIST', payload: ['x', 'y'] })
    expect(next.session.list).toEqual(['x', 'y'])
    expect(next.session.currentId).toBe('s1')
  })

  test('CLEAR_MESSAGES 清空 messages + 不动 agent', () => {
    const state = { ...initialState, messages: [{ role: 'user', content: 'q' }] }
    const next = agentReducer(state, { type: 'CLEAR_MESSAGES' })
    expect(next.messages).toEqual([])
  })

  test('CLEAR_MESSAGES 同步清除 contextRealTokens（v8.4.2）', () => {
    const state = { ...initialState, messages: [{ role: 'user', content: 'q' }], contextRealTokens: 50000 }
    const next = agentReducer(state, { type: 'CLEAR_MESSAGES' })
    expect(next.messages).toEqual([])
    expect(next.contextRealTokens).toBe(0)
  })

  test('SET_MESSAGES 替换 messages（_streaming 字段默认 undefined）', () => {
    const state = { ...initialState, messages: [{ role: 'user', content: 'old' }] }
    const next = agentReducer(state, {
      type: 'SET_MESSAGES',
      payload: [{ role: 'user', content: 'new' }]
    })
    // 实现会做规范化（toolCalls/timeline/stopReason 字段默认填好），
    // 这里只检查关键字段 + 历史消息不带内存标记
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].role).toBe('user')
    expect(next.messages[0].content).toBe('new')
    expect(next.messages[0]._streaming).toBeUndefined()
    expect(next.messages[0]._agentRequestId).toBeUndefined()
  })

  test('RESET_AGENT 重置 agent 字段', () => {
    const state = {
      ...initialState,
      agent: { ...initialState.agent, status: 'streaming', replyText: 'x' }
    }
    const next = agentReducer(state, { type: 'RESET_AGENT' })
    expect(next.agent.status).toBe('idle')
    expect(next.agent.replyText).toBe('')
  })

  test('SET_CONFIRMATION 存 AI 确认请求', () => {
    const state = { ...initialState, confirmation: null }
    const next = agentReducer(state, { type: 'SET_CONFIRMATION', payload: { toolName: 'x' } })
    expect(next.confirmation).toEqual({ toolName: 'x' })
  })

  test('ERROR 状态转 error', () => {
    const state = { ...initialState, agent: { ...initialState.agent, status: 'streaming' } }
    const next = agentReducer(state, { type: 'ERROR', payload: { error: 'oops' } })
    expect(next.agent.status).toBe('error')
  })
})

describe('mergeReplyToMessages', () => {
  test('找到流式消息 → 替换为最终', () => {
    const msgs = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r1' }
    ]
    const next = mergeReplyToMessages(msgs, 'hi', 'r1', [], null)
    expect(next).toHaveLength(2)
    expect(next[1].content).toBe('hi')
    expect(next[1]._streaming).toBe(false)
  })

  test('没找到流式消息 → 追加（异常兜底）', () => {
    const msgs = [{ role: 'user', content: 'q' }]
    const next = mergeReplyToMessages(msgs, 'hi', 'r1', [], null)
    expect(next).toHaveLength(2)
    expect(next[1].role).toBe('assistant')
  })

  test('aborted 时 stopReason 写入', () => {
    const msgs = [{ role: 'assistant', _streaming: true, _agentRequestId: 'r1' }]
    const next = mergeReplyToMessages(msgs, 'partial', 'r1', [], 'aborted')
    expect(next[0].stopReason).toBe('aborted')
  })
})

describe('agentReducer - COMPRESS_MESSAGES', () => {
  test('用 summary + recentMessages 替换原 messages', () => {
    const state = {
      ...initialState,
      messages: [
        { role: 'user', content: 'old1' },
        { role: 'assistant', content: 'reply1' },
        { role: 'user', content: 'old2' },
        { role: 'assistant', content: 'reply2' }
      ]
    }
    const summary = '## Goal\n测试目标'
    const recent = [
      { role: 'user', content: 'recent' },
      { role: 'assistant', content: 'recent reply' }
    ]
    const next = agentReducer(state, {
      type: 'COMPRESS_MESSAGES',
      payload: { summary, recentMessages: recent }
    })
    expect(next.messages).toHaveLength(3)
    expect(next.messages[0]).toMatchObject({
      role: 'assistant',
      content: summary,
      _compacted: true
    })
    expect(next.messages[1]).toMatchObject({ role: 'user', content: 'recent' })
    expect(next.messages[2]).toMatchObject({ role: 'assistant', content: 'recent reply' })
  })

  test('空 messages 时 summary 单独入列', () => {
    const state = { ...initialState, messages: [] }
    const next = agentReducer(state, {
      type: 'COMPRESS_MESSAGES',
      payload: { summary: 's', recentMessages: [] }
    })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]._compacted).toBe(true)
  })
})

describe('agentReducer - SET_CONTEXT_STATS', () => {
  test('写入 contextRealTokens', () => {
    const next = agentReducer(initialState, {
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: 12345 }
    })
    expect(next.contextRealTokens).toBe(12345)
  })

  test('realTokens 为 0 时清空', () => {
    const stateWithTokens = {
      ...initialState,
      contextRealTokens: 100
    }
    const next = agentReducer(stateWithTokens, {
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: 0 }
    })
    expect(next.contextRealTokens).toBe(0)
  })

  test('同步更新 contextLimit（v8.4.2）', () => {
    const next = agentReducer(initialState, {
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: 50000, contextLimit: 128000 }
    })
    expect(next.contextRealTokens).toBe(50000)
    expect(next.contextLimit).toBe(128000)
  })

  test('contextLimit 不传时保持原值（v8.4.2）', () => {
    const state = { ...initialState, contextLimit: 512000 }
    const next = agentReducer(state, {
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: 500 }
    })
    expect(next.contextRealTokens).toBe(500)
    expect(next.contextLimit).toBe(512000)
  })

  // v0.9.x 圆环修复：真实值落点快照（real + 增量估算的基础）
  test('更新真实值时记录消息数快照 contextRealTokensAt', () => {
    const stateWithMsgs = {
      ...initialState,
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' }
      ]
    }
    const next = agentReducer(stateWithMsgs, {
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: 80000 }
    })
    expect(next.contextRealTokens).toBe(80000)
    expect(next.contextRealTokensAt).toBe(3)
  })
})

describe('agentReducer - PAUSE/RESUME（v0.9.x 精确恢复暂停前状态）', () => {
  const working = (status) => ({ ...initialState, agent: { ...initialState.agent, status } })

  test('thinking/streaming/tool_calling 可暂停，且记录 prevStatus', () => {
    for (const s of ['thinking', 'streaming', 'tool_calling']) {
      const next = agentReducer(working(s), { type: 'PAUSE' })
      expect(next.agent.status).toBe('paused')
      expect(next.agent.prevStatus).toBe(s)
    }
  })

  test('RESUME 恢复暂停前的工作态（非 running）', () => {
    const paused = agentReducer(working('tool_calling'), { type: 'PAUSE' })
    const next = agentReducer(paused, { type: 'RESUME' })
    expect(next.agent.status).toBe('tool_calling')
    expect(next.agent.prevStatus).toBeNull()
  })

  test('paused 无 prevStatus 时 RESUME 兜底为 streaming（流式预览可见）', () => {
    const paused = { ...initialState, agent: { ...initialState.agent, status: 'paused', prevStatus: null } }
    const next = agentReducer(paused, { type: 'RESUME' })
    expect(next.agent.status).toBe('streaming')
  })

  test('idle/done/error/paused 不可暂停', () => {
    for (const s of ['idle', 'done', 'error', 'paused']) {
      const next = agentReducer(working(s), { type: 'PAUSE' })
      expect(next.agent.status).toBe(s)
    }
  })

  test('非 paused 状态不可 RESUME', () => {
    for (const s of ['idle', 'streaming', 'done']) {
      const next = agentReducer(working(s), { type: 'RESUME' })
      expect(next.agent.status).toBe(s)
    }
  })
})

describe('SET_SESSION_ARCHIVED', () => {
  test('设置当前会话归档标志', () => {
    const next = agentReducer(initialState, { type: 'SET_SESSION_ARCHIVED', payload: true })
    expect(next.session.currentArchived).toBe(true)
  })

  test('新建会话（SET_SESSION_ID）重置归档标志为 false', () => {
    const archivedState = agentReducer(initialState, { type: 'SET_SESSION_ARCHIVED', payload: true })
    const next = agentReducer(archivedState, { type: 'SET_SESSION_ID', payload: 'session-new' })
    expect(next.session.currentArchived).toBe(false)
  })
})

describe('SEAL_STREAMING_MESSAGE（v0.6.2 插话按时序显示）', () => {
  test('有内容：封存当前 streaming 气泡（content+timeline+_sealed），清空 replyText/timeline', () => {
    const state = {
      ...initialState,
      messages: [
        { role: 'user', content: '原始' },
        { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r1' }
      ],
      agent: {
        ...initialState.agent,
        requestId: 'r1',
        replyText: '第一段话',
        timeline: [{ type: 'tool', toolCallId: 'c1', status: 'done' }]
      }
    }
    const next = agentReducer(state, { type: 'SEAL_STREAMING_MESSAGE' })
    const sealed = next.messages[1]
    expect(sealed._streaming).toBe(false)
    expect(sealed._sealed).toBe(true)
    expect(sealed.content).toBe('第一段话')
    expect(sealed.timeline).toEqual([{ type: 'tool', toolCallId: 'c1', status: 'done' }])
    expect(next.agent.replyText).toBe('')
    expect(next.agent.timeline).toEqual([])
  })

  test('无内容：移除空气泡（插话时 AI 还没输出）', () => {
    const state = {
      ...initialState,
      messages: [
        { role: 'user', content: '原始' },
        { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r1' }
      ],
      agent: { ...initialState.agent, requestId: 'r1', replyText: '', timeline: [] }
    }
    const next = agentReducer(state, { type: 'SEAL_STREAMING_MESSAGE' })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].role).toBe('user')
    expect(next.agent.replyText).toBe('')
  })

  test('无 streaming 气泡：只清空 replyText/timeline，消息不动', () => {
    const state = {
      ...initialState,
      messages: [{ role: 'user', content: '原始' }],
      agent: {
        ...initialState.agent,
        replyText: 'x',
        timeline: [{ type: 'reasoning', status: 'done', content: '' }]
      }
    }
    const next = agentReducer(state, { type: 'SEAL_STREAMING_MESSAGE' })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].content).toBe('原始')
    expect(next.agent.replyText).toBe('')
    expect(next.agent.timeline).toEqual([])
  })
})
