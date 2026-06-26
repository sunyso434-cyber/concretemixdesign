// src/main/agent/__tests__/errorClassifier.test.js
// v8.3.8: truncateDetails 循环引用兜底测试
const { truncateDetails, sanitizeDetails } = require('../errorClassifier')

describe('errorClassifier.truncateDetails（v8.3.8 循环引用兜底）', () => {
  test('含 self-reference 的对象不应抛错（核心修复）', () => {
    const circ = { a: 1, b: 'normal' }
    circ.self = circ
    expect(() => truncateDetails(circ)).not.toThrow()
  })

  test('含循环引用 → 走软截断路径（不应触发硬截断 _truncated 元信息）', () => {
    const circ = { a: 1, b: 'x'.repeat(3000) }
    circ.self = circ
    const result = truncateDetails(circ)
    expect(result._truncated).toBeUndefined()  // 不应硬截断
    expect(result.b.endsWith('...')).toBe(true)  // 软截断仍生效
  })

  test('含循环引用 + 大对象 → 不抛错也不硬截断（兜底 0）', () => {
    const circ = { data: 'x'.repeat(60 * 1024) }  // > HARD_LIMIT
    circ.self = circ
    expect(() => truncateDetails(circ)).not.toThrow()
    const result = truncateDetails(circ)
    // 循环引用导致 totalSize=0，绕过硬截断，走软截断
    expect(result._truncated).toBeUndefined()
    expect(result.data.endsWith('...')).toBe(true)
  })

  test('非对象输入原样返回（回归保护）', () => {
    expect(truncateDetails(null)).toBe(null)
    expect(truncateDetails(undefined)).toBe(undefined)
    expect(truncateDetails('str')).toBe('str')
    expect(truncateDetails(42)).toBe(42)
  })

  test('普通对象超过 HARD_LIMIT(50KB) 走硬截断（回归保护）', () => {
    const big = { data: 'x'.repeat(60 * 1024) }
    const result = truncateDetails(big)
    expect(result._truncated).toBe(true)
    expect(result.originalSize).toBeGreaterThan(50 * 1024)
    expect(result.reason).toContain('50KB')
  })

  test('普通对象字段超 SOFT_LIMIT(2KB) 软截断（回归保护）', () => {
    const obj = { msg: 'x'.repeat(3000), short: 'ok' }
    const result = truncateDetails(obj)
    expect(result.msg.endsWith('...')).toBe(true)
    expect(result.msg.length).toBe(2048 + 3)  // SOFT_LIMIT + '...'
    expect(result.short).toBe('ok')
  })

  test('空对象正常返回', () => {
    expect(truncateDetails({})).toEqual({})
  })
})

// v8.3.8 验证：sanitizeDetails 调用链未受 truncateDetails 改动影响
describe('errorClassifier.sanitizeDetails（回归保护）', () => {
  test('正常脱敏（apiKey/Authorization 字段名命中直接替换为 ***）', () => {
    const input = { apiKey: 'sk-12345', Authorization: 'Bearer abc', name: 'foo' }
    const out = sanitizeDetails(input)
    expect(out.apiKey).toBe('***')          // 字段名命中 → '***'
    expect(out.Authorization).toBe('***')   // 字段名命中 → '***'（不是 'Bearer ***'）
    expect(out.name).toBe('foo')
  })

  test('Bearer 前缀字符串值脱敏（非字段名命中）', () => {
    const input = { customHeader: 'Bearer xyz123', normal: 'ok' }
    const out = sanitizeDetails(input)
    expect(out.customHeader).toBe('Bearer ***')
    expect(out.normal).toBe('ok')
  })
})