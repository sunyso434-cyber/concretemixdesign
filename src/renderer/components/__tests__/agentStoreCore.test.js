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
    const next = agentReducer(state, { type: 'SET_RUN_MODE', payload: 'auto' })
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

  test('RESET_AGENT 重置 agent 字段（保留 runMode）', () => {
    const state = {
      ...initialState,
      agent: { ...initialState.agent, status: 'streaming', replyText: 'x', runMode: 'auto' }
    }
    const next = agentReducer(state, { type: 'RESET_AGENT' })
    expect(next.agent.status).toBe('idle')
    expect(next.agent.replyText).toBe('')
    expect(next.agent.runMode).toBe('auto')
  })

  test('SET_RUN_MODE 切换运行模式', () => {
    const state = { ...initialState }
    const next = agentReducer(state, { type: 'SET_RUN_MODE', payload: 'auto' })
    expect(next.agent.runMode).toBe('auto')
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
})
