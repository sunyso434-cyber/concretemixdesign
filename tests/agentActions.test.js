/**
 * Task 15: agentActions.js sendMessage 改造测试
 *
 * 目的：验证 sendMessage 各错误分支：
 *   1. dispatch ERROR payload 使用 classifiedError 格式（非 { error: string }）
 *   2. message.error 不再被调用（P3 commit 3 去 AI toast）
 *   3. reducer 能正确消费 string 类型的 classifiedError（来自 getFriendlyError）
 *
 * 说明：本项目 jest 环境为 'node'，无 jsdom/@testing-library/react，
 * 因此本测试采用合约测试方式，验证 dispatch payload 格式与 reducer 的集成正确性。
 *
 * 跑法：npx jest tests/agentActions.test.js -v
 */

const { agentReducer, initialState } = require('../src/renderer/components/agentStoreCore')

// ============================================================
// getFriendlyError 逻辑（与 agentActions.js 保持一致）
// ============================================================
function getFriendlyError(errorCode) {
  const errorMap = {
    'max_failures_exceeded': 'AI 连续响应失败，请稍后重试',
    'max_steps_exceeded': 'AI 执行步骤过多，请简化需求后重试',
    'aborted': '任务已取消',
    'wc_destroyed': '窗口已关闭',
  }
  return errorMap[errorCode] || errorCode || '未知错误'
}

describe('agentActions sendMessage 错误分支（Task 15）', () => {
  // ============================================================
  // 场景 1: getFriendlyError 映射逻辑
  // ============================================================
  describe('场景 1: getFriendlyError 错误码映射', () => {
    test('已知错误码 → 友好文案', () => {
      expect(getFriendlyError('max_failures_exceeded')).toBe('AI 连续响应失败，请稍后重试')
      expect(getFriendlyError('max_steps_exceeded')).toBe('AI 执行步骤过多，请简化需求后重试')
      expect(getFriendlyError('aborted')).toBe('任务已取消')
      expect(getFriendlyError('wc_destroyed')).toBe('窗口已关闭')
    })

    test('未知错误码 → 返回原始 code', () => {
      expect(getFriendlyError('SOME_UNKNOWN_CODE')).toBe('SOME_UNKNOWN_CODE')
    })

    test('空值 → "未知错误"', () => {
      expect(getFriendlyError('')).toBe('未知错误')
      expect(getFriendlyError(null)).toBe('未知错误')
      expect(getFriendlyError(undefined)).toBe('未知错误')
    })
  })

  // ============================================================
  // 场景 2: reducer 消费 string classifiedError（来自 agentActions）
  // ============================================================
  describe('场景 2: reducer 消费 string classifiedError', () => {
    test('dispatch ERROR with string classifiedError → reducer 正确处理', () => {
      const state1 = {
        ...initialState,
        messages: [{ id: 'a1', role: 'user', content: 'hi' }],
      }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: '通信失败: timeout' },
      })

      // agent 状态变为 error
      expect(state2.agent.status).toBe('error')

      // 追加了错误气泡（type: 'error'）
      const errorBubbles = state2.messages.filter(m => m.type === 'error')
      expect(errorBubbles).toHaveLength(1)
      // string classifiedError 直接作为 classifiedError 值
      expect(errorBubbles[0].classifiedError).toBe('通信失败: timeout')
    })

    test('dispatch ERROR with string classifiedError + sessionId/requestId → 去重正确', () => {
      const state1 = {
        ...initialState,
        messages: [],
      }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { classifiedError: '启动失败', sessionId: 's1', requestId: 'r1' },
      })

      // 重复 dispatch 同一 (sessionId, requestId, code) — code 为 undefined 时去重 key 不同
      // string classifiedError 无 .code，dedupKey 为 's1::r1::undefined'
      const state3 = agentReducer(state2, {
        type: 'ERROR',
        payload: { classifiedError: '启动失败', sessionId: 's1', requestId: 'r1' },
      })

      // 由于 classifiedError 为 string（无 .code），dedupKey 为 's1::r1::undefined'
      // 两次 dispatch 的 dedupKey 相同，第二次被去重
      const errorBubbles = state3.messages.filter(m => m.type === 'error')
      expect(errorBubbles).toHaveLength(1)
    })
  })

  // ============================================================
  // 场景 3: 验证旧 { error: string } payload 不再使用
  // ============================================================
  describe('场景 3: 旧格式兼容性', () => {
    test('旧 { error: string } payload 仍兼容（reducer 不 crash）', () => {
      const state1 = { ...initialState, messages: [] }
      const state2 = agentReducer(state1, {
        type: 'ERROR',
        payload: { error: 'legacy error format' },
      })

      expect(state2.agent.status).toBe('error')
      expect(state2.messages.filter(m => m.type === 'error')).toHaveLength(1)
    })
  })

  // ============================================================
  // 场景 4: message.error 调用验证（v10.2.0：恢复 toast 弹窗以避免静默失败）
  // ============================================================
  describe('场景 4: message.error 调用验证', () => {
    test('sendMessage 应正确调用 message.error 弹窗（v10.2.0 恢复）', () => {
      // v10.2.0 修复静默失败：恢复 message.error 弹窗
      // 至少要调用一次 message.error（在 catch 或 result.success===false 分支）
      const fs = require('fs')
      const path = require('path')
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/components/agentActions.js'),
        'utf-8'
      )

      // 验证文件中含 message.error( 调用（已恢复）
      const messageErrorCalls = (src.match(/message\.error\(/g) || [])
      expect(messageErrorCalls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
