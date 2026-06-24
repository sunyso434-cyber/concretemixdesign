/**
 * Task 6: ABORT 行为验证测试
 *
 * 目的：在 ERROR 改造之前，验证 ABORT 是否真的能保留 AI 思考内容（replyText）。
 * Spec 5.0 风险：ABORT 调用 mergeReplyToMessages()，但不清楚流式占位消息是否真的
 * 被插入到 messages[] 中。
 *
 * 结论：mergeReplyToMessages 查找 _streaming: true 的占位消息，找到则合并，
 * 找不到则追加。两种路径都能保留 replyText。
 *
 * 关键发现：
 * - SEND_MESSAGE (reducer) 不插入占位消息，但 sendMessage() (agentActions.js)
 *   在 await agent:run 之前同步插入 _streaming: true 占位
 * - 正常流程中，用户点击停止时占位一定已存在（JS 单线程保证）
 * - 即使占位不存在，mergeReplyToMessages 的兜底追加路径也能保留内容
 *
 * 跑法：npx jest tests/abortBehavior.test.js -v
 */

const { agentReducer, mergeReplyToMessages, initialState } = require('../src/renderer/components/agentStoreCore')

describe('ABORT 行为验证（Task 6）', () => {
  // ============================================================
  // 场景 1: 正常流程 — _streaming: true 占位存在（agentActions 已插入）
  // ============================================================
  describe('场景 1: 占位存在（正常流式流程）', () => {
    test('ABORT 将 replyText 合并到占位消息中', () => {
      const state = {
        ...initialState,
        agent: {
          ...initialState.agent,
          status: 'streaming',
          replyText: 'AI 已输出 50 字的部分思考内容',
          requestId: 'r-test-1',
          timeline: [
            { type: 'reasoning', content: '思考中...', status: 'done', roundIndex: 0, collapsed: true }
          ]
        },
        messages: [
          { role: 'user', content: '帮我设计配合比' },
          { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r-test-1' }
        ]
      }

      const newState = agentReducer(state, { type: 'ABORT' })

      // 1. agent 状态变为 aborted
      expect(newState.agent.status).toBe('aborted')

      // 2. replyText 被清空（已合并到 messages）
      expect(newState.agent.replyText).toBe('')

      // 3. 占位消息被替换为完整消息，内容保留
      const lastAssistant = [...newState.messages].reverse().find(m => m.role === 'assistant')
      expect(lastAssistant).toBeDefined()
      expect(lastAssistant.content).toBe('AI 已输出 50 字的部分思考内容')
      expect(lastAssistant.stopReason).toBe('aborted')
      expect(lastAssistant._streaming).toBe(false)   // 消流式标记
      expect(lastAssistant._agentRequestId).toBe('r-test-1')

      // 4. timeline 被保留
      expect(lastAssistant.timeline).toEqual(state.agent.timeline)

      // 5. 消息总数不变（替换，不追加）
      expect(newState.messages).toHaveLength(2)
    })

    test('ABORT 保留 reasoning timeline 内容', () => {
      const state = {
        ...initialState,
        agent: {
          ...initialState.agent,
          status: 'streaming',
          replyText: '根据计算，水胶比为 0.45...',
          requestId: 'r-test-2',
          timeline: [
            { type: 'reasoning', content: '第一步：分析需求', status: 'done', roundIndex: 0, collapsed: true },
            { type: 'reasoning', content: '第二步：计算水胶比', status: 'done', roundIndex: 1, collapsed: true },
            { type: 'tool', toolCallId: 'c1', toolName: 'calculate', args: {}, status: 'done', result: 'ok' }
          ]
        },
        messages: [
          { role: 'user', content: 'C30 配合比' },
          { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r-test-2' }
        ]
      }

      const newState = agentReducer(state, { type: 'ABORT' })
      const lastAssistant = [...newState.messages].reverse().find(m => m.role === 'assistant')

      expect(lastAssistant.timeline).toHaveLength(3)
      expect(lastAssistant.timeline[0].content).toBe('第一步：分析需求')
      expect(lastAssistant.timeline[1].content).toBe('第二步：计算水胶比')
      expect(lastAssistant.stopReason).toBe('aborted')
    })

    test('ABORT 保留空 replyText（还没开始输出就停了）', () => {
      const state = {
        ...initialState,
        agent: {
          ...initialState.agent,
          status: 'thinking',     // 还在思考，没开始流式输出
          replyText: '',           // 还没文字
          requestId: 'r-test-3',
          timeline: [
            { type: 'reasoning', content: '正在理解用户需求...', status: 'running', roundIndex: 0, collapsed: true }
          ]
        },
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r-test-3' }
        ]
      }

      const newState = agentReducer(state, { type: 'ABORT' })
      const lastAssistant = [...newState.messages].reverse().find(m => m.role === 'assistant')

      // 内容为空但 stopReason 正确标记
      expect(lastAssistant.content).toBe('')
      expect(lastAssistant.stopReason).toBe('aborted')
      // timeline 仍在（思考过程保留）
      expect(lastAssistant.timeline).toHaveLength(1)
      expect(lastAssistant.timeline[0].content).toBe('正在理解用户需求...')
    })
  })

  // ============================================================
  // 场景 2: 兜底路径 — 占位不存在（mergeReplyToMessages 追加新消息）
  // ============================================================
  describe('场景 2: 占位不存在（兜底追加路径）', () => {
    test('ABORT 无占位时追加新 assistant 消息（兜底）', () => {
      const state = {
        ...initialState,
        agent: {
          ...initialState.agent,
          status: 'streaming',
          replyText: 'AI 已输出部分内容但占位丢失',
          requestId: 'r-test-4',
          timeline: []
        },
        messages: [
          { role: 'user', content: 'hello' }
          // 注意：没有 _streaming: true 占位消息
        ]
      }

      const newState = agentReducer(state, { type: 'ABORT' })

      // 1. agent 状态变为 aborted
      expect(newState.agent.status).toBe('aborted')

      // 2. 追加了一条新消息（消息数 +1）
      expect(newState.messages).toHaveLength(2)

      // 3. 新消息保留了 replyText
      const lastAssistant = newState.messages[1]
      expect(lastAssistant.role).toBe('assistant')
      expect(lastAssistant.content).toBe('AI 已输出部分内容但占位丢失')
      expect(lastAssistant.stopReason).toBe('aborted')
    })

    test('ABORT 无占位 + 无 replyText → 追加空消息但标记 aborted', () => {
      const state = {
        ...initialState,
        agent: {
          ...initialState.agent,
          status: 'thinking',
          replyText: '',
          requestId: 'r-test-5',
          timeline: []
        },
        messages: [
          { role: 'user', content: 'hello' }
        ]
      }

      const newState = agentReducer(state, { type: 'ABORT' })

      expect(newState.messages).toHaveLength(2)
      expect(newState.messages[1].role).toBe('assistant')
      expect(newState.messages[1].content).toBe('')
      expect(newState.messages[1].stopReason).toBe('aborted')
    })
  })

  // ============================================================
  // 场景 3: mergeReplyToMessages 单元测试（核心函数）
  // ============================================================
  describe('mergeReplyToMessages 单元测试', () => {
    test('找到 _streaming: true → 原地替换（不追加）', () => {
      const msgs = [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'old streaming...', _streaming: true, _agentRequestId: 'r1' }
      ]
      const result = mergeReplyToMessages(msgs, 'final content', 'r1', [], 'aborted')

      expect(result).toHaveLength(2)              // 不追加
      expect(result[1].content).toBe('final content')
      expect(result[1]._streaming).toBe(false)     // 消流式
      expect(result[1].stopReason).toBe('aborted')
    })

    test('找不到 _streaming: true → 追加新消息', () => {
      const msgs = [
        { role: 'user', content: 'q' }
      ]
      const result = mergeReplyToMessages(msgs, 'fallback content', 'r1', [], 'aborted')

      expect(result).toHaveLength(2)
      expect(result[1].role).toBe('assistant')
      expect(result[1].content).toBe('fallback content')
      expect(result[1].stopReason).toBe('aborted')
    })

    test('_streaming 不是严格 true 时走追加路径（falsy 值误判防护）', () => {
      // spec 6.3: 历史消息 _streaming 为 undefined（falsy），不会被误匹配
      const msgs = [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'old', _streaming: undefined, _agentRequestId: 'r1' }
      ]
      const result = mergeReplyToMessages(msgs, 'new content', 'r1', [], 'aborted')

      // _streaming: undefined 不是 === true，走追加路径
      expect(result).toHaveLength(3)
      expect(result[2].content).toBe('new content')
    })

    test('requestId 不匹配时走追加路径', () => {
      const msgs = [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r-other' }
      ]
      const result = mergeReplyToMessages(msgs, 'content', 'r-current', [], 'aborted')

      // requestId 不匹配，走追加路径
      expect(result).toHaveLength(3)
      expect(result[1]._streaming).toBe(true)        // 旧占位不变
      expect(result[2].content).toBe('content')       // 新消息追加
    })
  })

  // ============================================================
  // 场景 4: ABORT 与 DONE 对比
  // ============================================================
  describe('ABORT vs DONE 对比', () => {
    test('DONE 的 stopReason 为 null，ABORT 为 "aborted"', () => {
      const baseState = {
        ...initialState,
        agent: {
          ...initialState.agent,
          replyText: '完成内容',
          requestId: 'r-cmp',
          timeline: []
        },
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: '', _streaming: true, _agentRequestId: 'r-cmp' }
        ]
      }

      const doneState = agentReducer(baseState, { type: 'DONE', payload: { reply: '完成内容' } })
      const abortState = agentReducer(baseState, { type: 'ABORT' })

      const doneMsg = [...doneState.messages].reverse().find(m => m.role === 'assistant')
      const abortMsg = [...abortState.messages].reverse().find(m => m.role === 'assistant')

      expect(doneMsg.stopReason).toBeNull()
      expect(abortMsg.stopReason).toBe('aborted')
      expect(doneState.agent.status).toBe('done')
      expect(abortState.agent.status).toBe('aborted')
    })
  })
})
