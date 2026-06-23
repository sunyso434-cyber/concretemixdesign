/**
 * Task 1: AI_ERROR_REGISTRY + createError 自动 lookup 行为验证
 * Spec: docs/superpowers/specs/2026-06-23-ai-error-code-display-design.md § 2.2 / § 3.3
 */
const { createError, AI_ERROR_REGISTRY } = require('../src/main/agent/ErrorCodes')

describe('createError + AI_ERROR_REGISTRY', () => {
  test('传入已注册 code 时自动补全 title/hint/recovery', () => {
    const result = createError('E-LLM-401')
    expect(result.code).toBe('E-LLM-401')
    expect(result.title).toBe('AI 密钥无效或未配置')  // 来自 registry
    expect(result.hint).toMatch(/设置/)                 // 来自 registry
    expect(result.recovery).toBe('fix_settings')        // 来自 registry
  })

  test('未注册 code 时不补全，返回原样', () => {
    const result = createError('E-UNKNOWN-CODE')
    expect(result.code).toBe('E-UNKNOWN-CODE')
    expect(result.title).toBeUndefined()
  })

  test('显式传入的 message/hint 覆盖 registry', () => {
    const result = createError('E-LLM-401', 'custom msg', 'custom hint')
    expect(result.title).toBe('custom msg')
    expect(result.hint).toBe('custom hint')
  })

  test('AI_ERROR_REGISTRY 至少包含 19 条编码（spec 2.2 完整列表）', () => {
    const codes = Object.keys(AI_ERROR_REGISTRY)
    expect(codes.length).toBeGreaterThanOrEqual(19)
  })

  // 关键回归测试：覆盖 review 反馈，确保无 error / errorCode 别名字段泄漏
  test('createError 返回值只包含 6 个契约字段（无 error / errorCode）', () => {
    const result = createError('E-LLM-401')
    expect(Object.keys(result).sort()).toEqual(
      ['code', 'details', 'hint', 'recovery', 'success', 'title'].sort()
    )
    expect(result.error).toBeUndefined()
    expect(result.errorCode).toBeUndefined()
  })
})
