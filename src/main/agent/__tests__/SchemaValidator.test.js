const SchemaValidator = require('../SchemaValidator')
const ErrorCodes = require('../ErrorCodes')

describe('SchemaValidator', () => {
  const validator = new SchemaValidator()

  // ===== 必填参数 =====
  test('required 字段缺失应返回 invalid + PARAM_MISSING', () => {
    const schema = { name: { type: 'string', required: true } }
    const result = validator.validate({}, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_MISSING)
    expect(result.errorMessage).toMatch(/缺少必填参数.*name/)
  })

  test('required 字段为 null 也算缺失', () => {
    const schema = { name: { type: 'string', required: true } }
    const result = validator.validate({ name: null }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_MISSING)
  })

  test('非 required 字段缺失不应报错', () => {
    const schema = { name: { type: 'string' } }
    const result = validator.validate({}, schema)
    expect(result.valid).toBe(true)
  })

  // ===== 类型校验 =====
  test('type=string 应校验类型', () => {
    const schema = { name: { type: 'string' } }
    const result = validator.validate({ name: 123 }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_INVALID_TYPE)
    expect(result.errorMessage).toMatch(/string/)
  })

  test('type=number 应校验类型', () => {
    const schema = { count: { type: 'number' } }
    const result = validator.validate({ count: 'abc' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_INVALID_TYPE)
    expect(result.errorMessage).toMatch(/number/)
  })

  test('type=integer 应拒绝浮点数', () => {
    const schema = { count: { type: 'integer' } }
    const result = validator.validate({ count: 1.5 }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_INVALID_TYPE)
  })

  test('type=boolean 应校验类型', () => {
    const schema = { flag: { type: 'boolean' } }
    const result = validator.validate({ flag: 'true' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_INVALID_TYPE)
  })

  test('type=array 应校验类型', () => {
    const schema = { items: { type: 'array' } }
    const result = validator.validate({ items: 'not array' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_INVALID_TYPE)
  })

  // ===== 枚举值 =====
  test('enum 应限制取值', () => {
    const schema = { color: { type: 'string', enum: ['red', 'blue'] } }
    const result = validator.validate({ color: 'green' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_OUT_OF_RANGE)
    expect(result.errorMessage).toMatch(/red.*blue/)
  })

  test('enum 合法值应通过', () => {
    const schema = { color: { type: 'string', enum: ['red', 'blue'] } }
    const result = validator.validate({ color: 'red' }, schema)
    expect(result.valid).toBe(true)
  })

  // ===== 数值范围 =====
  test('number 超过 max 应报错', () => {
    const schema = { age: { type: 'number', max: 100 } }
    const result = validator.validate({ age: 200 }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_OUT_OF_RANGE)
  })

  test('number 小于 min 应报错', () => {
    const schema = { age: { type: 'number', min: 0 } }
    const result = validator.validate({ age: -1 }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_OUT_OF_RANGE)
  })

  // ===== 数组长度 =====
  test('array 少于 minItems 应报错', () => {
    const schema = { tags: { type: 'array', minItems: 2 } }
    const result = validator.validate({ tags: ['a'] }, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_OUT_OF_RANGE)
  })

  // ===== 边界情况 =====
  test('空 schema 不应报错', () => {
    const result = validator.validate({}, {})
    expect(result.valid).toBe(true)
  })

  test('args 为 null 时应安全处理', () => {
    const schema = { name: { type: 'string', required: true } }
    const result = validator.validate(null, schema)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe(ErrorCodes.PARAM_MISSING)
  })

  test('多个错误时 details 应包含全部', () => {
    const schema = {
      a: { type: 'string', required: true },
      b: { type: 'number' }
    }
    const result = validator.validate({ b: 'abc' }, schema)
    expect(result.valid).toBe(false)
    expect(result.details.errors.length).toBe(2)
  })

  test('全部通过时应返回 { valid: true }', () => {
    const schema = {
      name: { type: 'string', required: true },
      age: { type: 'number', min: 0, max: 200 },
      tags: { type: 'array' }
    }
    const result = validator.validate(
      { name: 'A', age: 30, tags: ['x'] },
      schema
    )
    expect(result.valid).toBe(true)
  })

  // ===== 辅助方法 =====
  test('getRequiredParams 应只返回 required=true 的 key', () => {
    const schema = {
      a: { type: 'string', required: true },
      b: { type: 'number' },
      c: { type: 'string', required: true }
    }
    const result = validator.getRequiredParams(schema)
    expect(result.sort()).toEqual(['a', 'c'])
  })

  test('toJsonSchemaProperties 应转换 schema 格式', () => {
    const schema = {
      name: { type: 'string', description: '名称' },
      age: { type: 'number', min: 0, max: 100 }
    }
    const result = validator.toJsonSchemaProperties(schema)
    expect(result.name.type).toBe('string')
    expect(result.name.description).toBe('名称')
    expect(result.age.minimum).toBe(0)
    expect(result.age.maximum).toBe(100)
  })
})
