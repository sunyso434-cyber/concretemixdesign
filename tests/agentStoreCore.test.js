/**
 * Task 8: ERROR reducer 改造测试
 *
 * 目的：验证 ERROR reducer 能：
 *   1. 固化流式占位消息（保留 replyText + timeline，不丢 reasoning）
 *   2. 追加错误气泡（type: 'error' + classifiedError）
 *   3. 幂等去重（同 sessionId + requestId + code 不重复插入）
 *
 * 跑法：npx jest tests/agentStoreCore.test.js -v
 */

const { agentReducer, initialState } = require('../src/renderer/components/agentStoreCore')

describe('ERROR reducer（Task 8）', () => {
  const mockError = {
    code: 'E-LLM-401',
    title: 'AI 密钥无效',
    hint: '检查 API Key',
    details: { httpStatus: 401, occurredAt: '2026-06-23T14:32:08+08:00' },
  }

  // ============================================================
  // 场景 1: 流式占位有内容 → 固化为气泡 + 追加错误气泡
  // ============================================================
  describe('场景 1: 流式占位有 replyText', () => {
    test('固化占位消息（保留内容 + timeline）+ 追加错误气泡', () => {
      const state1 = {
        ...initialState,
        messages: [
          { id: 'a1', role: 'user', content: 'hi' },
          { id: 'a2', role: 'assistant', content: 'AI 思考中', _streaming: true },
        ],
        agent: {
          ...initialState.agent,
          replyText: 'AI 思考中',
          timeline: [{ type: 'reasoning', content: '正在分析' }],
        },
      }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      })

      // 1. agent 状态变为 error
      expect(state2.agent.status).toBe('error')

      // 2. 原占位消息被固化：内容保留、stopReason='error'、_streaming=false
      const lastAssistant = state2.messages
        .filter(m => m.role === 'assistant')
        .slice(-1)[0]
      expect(lastAssistant.content).toBe('AI 思考中')
      expect(lastAssistant.stopReason).toBe('error')
      expect(lastAssistant._streaming).toBe(false)

      // 3. timeline 被保留
      expect(lastAssistant.timeline).toEqual([
        { type: 'reasoning', content: '正在分析' },
      ])

      // 4. 追加了一条错误气泡
      const lastError = state2.messages
        .filter(m => m.type === 'error')
        .slice(-1)[0]
      expect(lastError).toBeDefined()
      expect(lastError.classifiedError.code).toBe('E-LLM-401')
      expect(lastError.classifiedError.title).toBe('AI 密钥无效')
    })
  })

  // ============================================================
  // 场景 2: 流式占位为空 → 只追加错误气泡（不产生空气泡）
  // ============================================================
  describe('场景 2: 无流式占位', () => {
    test('不产生空 assistant 气泡，只追加错误气泡', () => {
      const state1 = {
        ...initialState,
        messages: [{ id: 'a1', role: 'user', content: 'hi' }],
        agent: initialState.agent,
      }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      })

      // 没有 assistant 消息被创建
      const assistants = state2.messages.filter(m => m.role === 'assistant')
      expect(assistants).toHaveLength(0)

      // 只追加了一条错误气泡
      expect(state2.messages.filter(m => m.type === 'error')).toHaveLength(1)
    })
  })

  // ============================================================
  // 场景 3: 幂等去重
  // ============================================================
  describe('场景 3: 幂等去重', () => {
    test('重复 dispatch 同 (sessionId, requestId, code) → 只插入一次', () => {
      const state1 = { ...initialState, messages: [], agent: initialState.agent }
      const action = {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      }
      const state2 = agentReducer(state1, action)
      const state3 = agentReducer(state2, action)

      // 错误气泡只插入了一次
      expect(state3.messages.filter(m => m.type === 'error')).toHaveLength(1)

      // 第二次 dispatch 仍更新了 agent.status
      expect(state3.agent.status).toBe('error')
    })

    test('不同 code → 分别插入', () => {
      const state1 = { ...initialState, messages: [], agent: initialState.agent }
      const err1 = {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      }
      const err2 = {
        type: 'ERROR',
        payload: {
          classifiedError: { ...mockError, code: 'E-LLM-500' },
          sessionId: 's1',
          requestId: 'r1',
        },
      }

      const state2 = agentReducer(state1, err1)
      const state3 = agentReducer(state2, err2)

      // 不同 code → 两条错误气泡
      expect(state3.messages.filter(m => m.type === 'error')).toHaveLength(2)
    })

    test('不同 requestId → 分别插入', () => {
      const state1 = { ...initialState, messages: [], agent: initialState.agent }
      const err1 = {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      }
      const err2 = {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r2' },
      }

      const state2 = agentReducer(state1, err1)
      const state3 = agentReducer(state2, err2)

      // 不同 requestId → 两条错误气泡
      expect(state3.messages.filter(m => m.type === 'error')).toHaveLength(2)
    })
  })

  // ============================================================
  // 场景 4: 保留 reasoning timeline
  // ============================================================
  describe('场景 4: timeline 保留', () => {
    test('复杂 timeline（reasoning + tool）被完整保留', () => {
      const state1 = {
        ...initialState,
        messages: [
          { role: 'user', content: 'C30 配合比' },
          {
            role: 'assistant',
            content: '',
            _streaming: true,
            _agentRequestId: 'r-complex',
          },
        ],
        agent: {
          ...initialState.agent,
          status: 'streaming',
          replyText: '根据计算，水胶比为 0.45...',
          requestId: 'r-complex',
          timeline: [
            {
              type: 'reasoning',
              content: '第一步：分析需求',
              status: 'done',
              roundIndex: 0,
              collapsed: true,
            },
            {
              type: 'reasoning',
              content: '第二步：计算水胶比',
              status: 'done',
              roundIndex: 1,
              collapsed: true,
            },
            {
              type: 'tool',
              toolCallId: 'c1',
              toolName: 'calculate',
              args: {},
              status: 'done',
              result: 'ok',
              collapsed: true,
            },
          ],
        },
      }

      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r-complex' },
      })

      const lastAssistant = state2.messages
        .filter(m => m.role === 'assistant')
        .slice(-1)[0]

      expect(lastAssistant.timeline).toHaveLength(3)
      expect(lastAssistant.timeline[0].content).toBe('第一步：分析需求')
      expect(lastAssistant.timeline[1].content).toBe('第二步：计算水胶比')
      expect(lastAssistant.timeline[2].toolName).toBe('calculate')
      expect(lastAssistant.stopReason).toBe('error')
    })
  })
})
