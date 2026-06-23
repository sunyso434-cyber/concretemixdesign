// tests/errorClassifier.test.js
// Task 2：错误分类器单元测试
const { classifyError, sanitizeDetails, truncateDetails } = require('../src/main/agent/errorClassifier')

describe('classifyError', () => {
  test('已结构化错误直接用（策略 1）', () => {
    const structured = { code: 'E-LLM-401', message: 'custom', hint: 'h', details: { httpStatus: 401 } }
    const result = classifyError(structured, { callSite: 'test' })
    expect(result.code).toBe('E-LLM-401')
    expect(result.title).toBe('AI 密钥无效或未配置')  // 来自 registry
  })

  test('axios 401 → E-LLM-401（策略 2）', () => {
    const err = new Error('Request failed')
    err.response = { status: 401, data: { error: { message: 'Invalid key' } } }
    expect(classifyError(err).code).toBe('E-LLM-401')
  })

  test('axios 402 → E-LLM-402', () => {
    const err = new Error('x'); err.response = { status: 402, data: {} }
    expect(classifyError(err).code).toBe('E-LLM-402')
  })

  test('axios 403 → E-LLM-403', () => {
    const err = new Error('x'); err.response = { status: 403, data: {} }
    expect(classifyError(err).code).toBe('E-LLM-403')
  })

  test('axios 413 → E-LLM-413', () => {
    const err = new Error('x'); err.response = { status: 413, data: {} }
    expect(classifyError(err).code).toBe('E-LLM-413')
  })

  test('axios 429 → E-LLM-429', () => {
    const err = new Error('x'); err.response = { status: 429, data: {} }
    expect(classifyError(err).code).toBe('E-LLM-429')
  })

  test('axios 500 → E-LLM-500', () => {
    const err = new Error('x'); err.response = { status: 500, data: {} }
    expect(classifyError(err).code).toBe('E-LLM-500')
  })

  test('axios 503 → E-LLM-503', () => {
    const err = new Error('x'); err.response = { status: 503, data: {} }
    expect(classifyError(err).code).toBe('E-LLM-503')
  })

  test('ECONNABORTED → E-NET-408（策略 3）', () => {
    const err = new Error('timeout'); err.code = 'ECONNABORTED'
    expect(classifyError(err).code).toBe('E-NET-408')
  })

  test('ENOTFOUND → E-NET-500', () => {
    const err = new Error('not found'); err.code = 'ENOTFOUND'
    expect(classifyError(err).code).toBe('E-NET-500')
  })

  test('字面量 max_failures_exceeded → E-AGENT-001（策略 4 优先于策略 5）', () => {
    const err = new Error('max_failures_exceeded: context length exceeded')
    expect(classifyError(err).code).toBe('E-AGENT-001')
  })

  test('字面量 max_steps_exceeded → E-AGENT-002', () => {
    const err = new Error('max_steps_exceeded')
    expect(classifyError(err).code).toBe('E-AGENT-002')
  })

  test('字面量 wc_destroyed → E-SYS-001', () => {
    const err = new Error('wc_destroyed')
    expect(classifyError(err).code).toBe('E-SYS-001')
  })

  test('关键词 "context length" → E-LLM-413（策略 5）', () => {
    const err = new Error('context length exceeded')
    expect(classifyError(err).code).toBe('E-LLM-413')
  })

  test('关键词 "maximum tokens" → E-LLM-413', () => {
    const err = new Error('maximum tokens reached')
    expect(classifyError(err).code).toBe('E-LLM-413')
  })

  test('普通 Error → E-SYS-999（策略 6 兜底）', () => {
    const err = new Error('something')
    const result = classifyError(err, { callSite: 'test' })
    expect(result.code).toBe('E-SYS-999')
    expect(result.details.rawMessage).toBe('something')
    expect(result.details.callSite).toBe('test')
  })

  test('null → E-SYS-999', () => {
    expect(classifyError(null).code).toBe('E-SYS-999')
  })

  test('undefined → E-SYS-999', () => {
    expect(classifyError(undefined).code).toBe('E-SYS-999')
  })
})

describe('sanitizeDetails', () => {
  test('apiKey 字段脱敏', () => {
    const r = sanitizeDetails({ apiKey: 'sk-xxx', normal: 'ok' })
    expect(r.apiKey).toBe('***')
    expect(r.normal).toBe('ok')
  })

  test('Authorization 字段脱敏', () => {
    const r = sanitizeDetails({ Authorization: 'Bearer abc' })
    expect(r.Authorization).toBe('***')
  })

  test('Bearer xxx 替换为 Bearer ***', () => {
    const r = sanitizeDetails({ headers: 'Bearer abcdef' })
    expect(r.headers).toBe('Bearer ***')
  })
})

describe('truncateDetails', () => {
  test('单字段超 2KB 截断带 ...', () => {
    const big = 'x'.repeat(3000)
    const r = truncateDetails({ msg: big })
    expect(r.msg.endsWith('...')).toBe(true)
    expect(r.msg.length).toBeLessThan(3000)
  })

  test('整个 details 超 50KB 替换为 _truncated', () => {
    const big = 'x'.repeat(60 * 1024)
    const r = truncateDetails({ msg: big })
    expect(r._truncated).toBe(true)
    expect(r.originalSize).toBeGreaterThan(50 * 1024)
  })
})