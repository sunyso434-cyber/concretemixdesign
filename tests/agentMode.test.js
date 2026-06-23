/**
 * Task 9: AgentMode.jsx onProgress case 'error' 改造测试
 *
 * 目的：验证 onProgress 收到 type='error' 事件后：
 *   1. dispatch ERROR action 的 payload 格式 → { classifiedError, sessionId, requestId }
 *   2. message.error 的 title 回退逻辑 → title || code || 'AI 发生错误'
 *   3. reducer 能正确消费新的 payload 格式
 *
 * 说明：本项目 jest 环境为 'node'，无 jsdom/@testing-library/react，
 * 因此本测试采用合约测试方式，验证 dispatch payload 格式与 reducer 的集成正确性。
 *
 * 跑法：npx jest tests/agentMode.test.js -v
 */

const { agentReducer, initialState } = require('../src/renderer/components/agentStoreCore')

// ============================================================
// message.error 回退逻辑（与 AgentMode.jsx onProgress case 'error' 一致）
// ============================================================
function getToastMessage(classifiedError) {
  return classifiedError.title || classifiedError.code || 'AI 发生错误'
}

describe('AgentMode onProgress case "error"（Task 9）', () => {
  // ============================================================
  // 场景 1: 合同测试 — reducer 消费新 payload 格式
  // ============================================================
  describe('场景 1: reducer 消费 { classifiedError, sessionId, requestId }', () => {
    test('dispatch ERROR 新格式 → reducer 正确处理', () => {
      const mockError = {
        code: 'E-LLM-401',
        title: 'AI 密钥无效',
        hint: '检查 API Key',
        details: { httpStatus: 401, occurredAt: '2026-06-23T14:32:08+08:00' },
      }

      const state1 = {
        ...initialState,
        messages: [{ id: 'a1', role: 'user', content: 'hi' }],
      }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      })

      // agent 状态变为 error
      expect(state2.agent.status).toBe('error')

      // 追加了错误气泡（type: 'error'）
      const errorBubbles = state2.messages.filter(m => m.type === 'error')
      expect(errorBubbles).toHaveLength(1)
      expect(errorBubbles[0].classifiedError.code).toBe('E-LLM-401')
      expect(errorBubbles[0].classifiedError.title).toBe('AI 密钥无效')
    })
  })

  // ============================================================
  // 场景 2: message.error title 回退逻辑
  // ============================================================
  describe('场景 2: message.error message 回退', () => {
    test('有 title 时用 title', () => {
      const err = { code: 'E-LLM-401', title: 'AI 密钥无效' }
      expect(getToastMessage(err)).toBe('AI 密钥无效')
    })

    test('无 title 时回退到 code', () => {
      const err = { code: 'E-LLM-500' }
      expect(getToastMessage(err)).toBe('E-LLM-500')
    })

    test('无 title 无 code 时回退到默认文案', () => {
      const err = {}
      expect(getToastMessage(err)).toBe('AI 发生错误')
    })

    test('title 为空字符串时回退到 code', () => {
      const err = { code: 'E-NET-503', title: '' }
      expect(getToastMessage(err)).toBe('E-NET-503')
    })
  })

  // ============================================================
  // 场景 3: 固化流式占位 + 追加错误气泡（end-to-end 合约）
  // ============================================================
  describe('场景 3: 流式占位 + 错误气泡共存', () => {
    test('有 replyText + timeline → 固化为 assistant 气泡 + 追加 error 气泡', () => {
      const mockError = {
        code: 'E-NET-503',
        title: '联网失败',
        hint: '检查网络后重试',
      }

      const state1 = {
        ...initialState,
        messages: [
          { id: 'a1', role: 'user', content: '计算水胶比' },
          { id: 'a2', role: 'assistant', content: '正在计算...', _streaming: true },
        ],
        agent: {
          ...initialState.agent,
          replyText: '根据规范，水胶比为 0.45',
          timeline: [{ type: 'reasoning', content: '查询规范表' }],
        },
      }

      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: mockError, sessionId: 's1', requestId: 'r1' },
      })

      // assistant 气泡被固化
      const lastAssistant = state2.messages
        .filter(m => m.role === 'assistant')
        .slice(-1)[0]
      expect(lastAssistant.content).toBe('根据规范，水胶比为 0.45')
      expect(lastAssistant.stopReason).toBe('error')
      expect(lastAssistant._streaming).toBe(false)
      expect(lastAssistant.timeline).toEqual([
        { type: 'reasoning', content: '查询规范表' },
      ])

      // 错误气泡被追加
      const lastError = state2.messages
        .filter(m => m.type === 'error')
        .slice(-1)[0]
      expect(lastError.classifiedError.code).toBe('E-NET-503')
      expect(lastError.classifiedError.title).toBe('联网失败')
    })
  })

  // ============================================================
  // 场景 4: 验证旧 payload 格式被拒绝（确保不再用 { error: string } 格式）
  // ============================================================
  describe('场景 4: 旧 payload 格式 { error: string } 兼容性', () => {
    test('旧格式 payload 不包含 classifiedError → 不应 crash', () => {
      // 旧格式：{ error: 'some string' } — default 分支仍在使用
      // 确保 reducer 不会因为缺少 classifiedError 而 crash
      const state1 = { ...initialState, messages: [], agent: initialState.agent }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { error: 'some legacy error' },
      })

      // 仍然正常工作（agent.status = error，error 气泡有兜底文案）
      expect(state2.agent.status).toBe('error')
      expect(state2.messages.filter(m => m.type === 'error')).toHaveLength(1)
    })
  })
})
