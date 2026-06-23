/**
 * Task 5: agentHandler IPC 出口接入 classifyError
 * Spec: docs/superpowers/specs/2026-06-23-ai-error-code-display-design.md § 3.4
 * Plan: docs/superpowers/plans/2026-06-23-ai-error-code-display-plan.md (Task 5)
 *
 * 验证 classifyError() 在 agentHandler 调用场景下的行为：
 * - 兜底分类 E-SYS-999
 * - sessionId / requestId 上下文透传
 * - 返回值 6 字段契约
 */

const { classifyError } = require('../src/main/agent/errorClassifier')

describe('agentHandler IPC 错误出口（classifyError 行为验证）', () => {
  // ==================== 兜底分类 ====================
  test('未知错误 → 兜底 E-SYS-999', () => {
    const r = classifyError(new Error('unexpected'), { callSite: 'agentHandler.agent:run' })
    expect(r.code).toBe('E-SYS-999')
    expect(r.title).toBeTruthy()
    expect(r.hint).toBeTruthy()
    expect(r.details.rawMessage).toBe('unexpected')
    expect(r.details.callSite).toBe('agentHandler.agent:run')
  })

  test('字符串错误 → 兜底 E-SYS-999', () => {
    const r = classifyError('some string error', { callSite: 'agentHandler.agent:run' })
    expect(r.code).toBe('E-SYS-999')
    expect(r.details.rawMessage).toBe('some string error')
  })

  test('null/undefined → 兜底 E-SYS-999', () => {
    const r1 = classifyError(null, { callSite: 't' })
    expect(r1.code).toBe('E-SYS-999')

    const r2 = classifyError(undefined, { callSite: 't' })
    expect(r2.code).toBe('E-SYS-999')
  })

  // ==================== sessionId / requestId 透传 ====================
  test('context.requestId 透传到 details', () => {
    const r = classifyError(new Error('x'), {
      callSite: 'agentHandler.agent:run',
      requestId: 'req_abc',
      sessionId: 'sess_xyz',
    })
    expect(r.details.requestId).toBe('req_abc')
    expect(r.details.sessionId).toBe('sess_xyz')
  })

  test('sessionId 可以为 undefined（渲染端首次连接时可能无 session）', () => {
    const r = classifyError(new Error('x'), {
      callSite: 'agentHandler.agent:run',
      requestId: 'req_def',
    })
    expect(r.details.requestId).toBe('req_def')
    expect(r.details.sessionId).toBeUndefined()
  })

  // ==================== 结构化错误直接透传（策略1） ====================
  test('策略 1：已含 code 的结构化错误直接透传（不重复分类）', () => {
    const structured = {
      code: 'E-LLM-401',
      message: 'Invalid API key',
      details: { rawMessage: 'Invalid API key' },
    }
    const r = classifyError(structured, {
      callSite: 'agentHandler.agent:run',
      requestId: 'req_123',
      sessionId: 'sess_456',
    })
    expect(r.code).toBe('E-LLM-401')
    expect(r.details.requestId).toBe('req_123')
    expect(r.details.sessionId).toBe('sess_456')
  })

  // ==================== 6 字段契约 ====================
  test('返回值只包含 createError 契约字段', () => {
    const r = classifyError(new Error('x'), { callSite: 't' })
    expect(r.success).toBe(false)
    expect(Object.keys(r).sort()).toEqual(
      ['code', 'details', 'hint', 'recovery', 'success', 'title'].sort()
    )
  })

  // ==================== details.occurredAt ====================
  test('details.occurredAt 是 ISO 时间串', () => {
    const r = classifyError(new Error('x'), { callSite: 't' })
    expect(r.details.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
