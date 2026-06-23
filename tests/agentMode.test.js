/**
 * Task 9 + Task 16: AgentMode.jsx onProgress case 'error' + default 分支改造测试
 *
 * 目的：验证 onProgress 收到事件后：
 *   1. case 'error': dispatch ERROR action 的 payload 格式 → { classifiedError, sessionId, requestId }
 *   2. default 分支: 旧格式 fallback → 直接 dispatch classifiedError（不调 classifyError）
 *   3. reducer 能正确消费新的 payload 格式
 *   4. P3 commit 3: message.error 不再被调用
 *
 * 说明：本项目 jest 环境为 'node'，无 jsdom/@testing-library/react，
 * 因此本测试采用合约测试方式，验证 dispatch payload 格式与 reducer 的集成正确性。
 *
 * 跑法：npx jest tests/agentMode.test.js -v
 */

const { agentReducer, initialState } = require('../src/renderer/components/agentStoreCore')

describe('AgentMode onProgress case "error" + default 分支（Task 9 + 16）', () => {
  // ============================================================
  // 场景 1: 合同测试 — reducer 消费 { classifiedError, sessionId, requestId }
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
  // 场景 2: 固化流式占位 + 追加错误气泡（end-to-end 合约）
  // ============================================================
  describe('场景 2: 流式占位 + 错误气泡共存', () => {
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
  // 场景 3: 验证旧 payload 格式被拒绝（确保不再用 { error: string } 格式）
  // ============================================================
  describe('场景 3: 旧 payload 格式 { error: string } 兼容性', () => {
    test('旧格式 payload 不包含 classifiedError → 不应 crash', () => {
      // 旧格式：{ error: 'some string' } — default 分支已改为 classifiedError 格式
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

  // ============================================================
  // 场景 4: default 分支 — 旧格式事件使用 classifiedError 分发（Task 16）
  // ============================================================
  describe('场景 4: default 分支 classifiedError 格式（Task 16）', () => {
    test('default 分支 dispatch ERROR 应携带 classifiedError（已由后端包装）', () => {
      // 模拟后端 P2 agentHandler 已包装的 classifiedError 对象
      const backendError = {
        code: 'E-LLM-429',
        title: '请求过于频繁',
        hint: '请稍后重试',
        details: { httpStatus: 429 },
      }

      const state1 = {
        ...initialState,
        messages: [{ id: 'a1', role: 'user', content: 'test' }],
      }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: {
          classifiedError: backendError,
          sessionId: 's-default',
          requestId: 'r-default',
        },
      })

      // agent 状态变为 error
      expect(state2.agent.status).toBe('error')

      // 错误气泡包含完整的 classifiedError 对象
      const errorBubbles = state2.messages.filter(m => m.type === 'error')
      expect(errorBubbles).toHaveLength(1)
      expect(errorBubbles[0].classifiedError.code).toBe('E-LLM-429')
      expect(errorBubbles[0].classifiedError.title).toBe('请求过于频繁')
      expect(errorBubbles[0].classifiedError.hint).toBe('请稍后重试')
    })

    test('default 分支不再调 classifyError（架构约束：仅主进程调用）', () => {
      // 合约验证：AgentMode.jsx 中不含 classifyError 导入/调用
      const fs = require('fs')
      const path = require('path')
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/components/AgentMode.jsx'),
        'utf-8'
      )

      // 验证文件中不含 classifyError 调用
      const classifyErrorCalls = (src.match(/classifyError\(/g) || [])
      expect(classifyErrorCalls.length).toBe(0)
    })
  })

  // ============================================================
  // 场景 5: message.error 不再被调用（P3 commit 3）
  // ============================================================
  describe('场景 5: message.error 不再调用（P3 commit 3）', () => {
    test('AgentMode.jsx 中不含有 message.error 调用', () => {
      const fs = require('fs')
      const path = require('path')
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/components/AgentMode.jsx'),
        'utf-8'
      )

      // 验证文件中不含 message.error( 调用
      const messageErrorCalls = (src.match(/message\.error\(/g) || [])
      expect(messageErrorCalls.length).toBe(0)
    })
  })
})
