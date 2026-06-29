/**
 * SchemaValidator 单元测试
 * 重点验证：嵌套 JSON Schema 格式校验（修复老板的核心 bug）
 */
const SchemaValidator = require('../../agent/SchemaValidator')

describe('SchemaValidator', () => {
  let validator

  beforeEach(() => {
    validator = new SchemaValidator()
  })

  describe('嵌套 JSON Schema 格式（v9.1.0 修复）', () => {
    // vision-config.js 的真实 schema
    const visionSchema = {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'API 基础地址' },
        apiKey: { type: 'string', description: 'API 密钥' },
        model: { type: 'string', description: '模型名称' },
        maxDimension: { type: 'integer', min: 256, max: 4096 },
        maxSizeMb: { type: 'integer', min: 1, max: 50 },
        enabled: { type: 'boolean' }
      },
      required: ['baseUrl', 'apiKey', 'model']
    }

    test('老板历史 bug：只传 enabled 应返回 valid:false（缺必填）', () => {
      // 老板 DB 里实际收到的 LLM arguments: { type, properties, required }
      // 等价于 schema 校验的"只传 enabled" 场景
      const result = validator.validate({ enabled: true }, visionSchema)
      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('PARAM_MISSING')  // SkillExecutor 会加 E- 前缀
      expect(result.details.errors.length).toBeGreaterThanOrEqual(3)  // 缺 baseUrl/apiKey/model
    })

    test('完全空对象应返回 valid:false', () => {
      const result = validator.validate({}, visionSchema)
      expect(result.valid).toBe(false)
    })

    test('传完整参数应返回 valid:true', () => {
      const result = validator.validate({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'qwen-vl-plus'
      }, visionSchema)
      expect(result.valid).toBe(true)
    })

    test('传完整参数 + 可选字段应返回 valid:true', () => {
      const result = validator.validate({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'qwen-vl-plus',
        maxDimension: 1024,
        enabled: true
      }, visionSchema)
      expect(result.valid).toBe(true)
    })

    test('baseUrl 传空字符串应返回 valid:false（必填不允许空）', () => {
      const result = validator.validate({
        baseUrl: '',
        apiKey: 'sk-test',
        model: 'qwen-vl-plus'
      }, visionSchema)
      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('PARAM_MISSING')
    })

    test('maxDimension 超出范围应返回 valid:false', () => {
      const result = validator.validate({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'qwen-vl-plus',
        maxDimension: 100  // 小于 min:256
      }, visionSchema)
      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('PARAM_OUT_OF_RANGE')
    })

    test('类型错误应返回 valid:false', () => {
      const result = validator.validate({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'qwen-vl-plus',
        maxDimension: 'not a number'
      }, visionSchema)
      expect(result.valid).toBe(false)
    })
  })

  describe('flat schema 格式（向后兼容）', () => {
    test('旧 flat 格式仍能正常校验', () => {
      const flatSchema = {
        query: { type: 'string', required: true },
        topK: { type: 'number', min: 1, max: 50, required: false }
      }
      // 缺必填
      expect(validator.validate({}, flatSchema).valid).toBe(false)
      // 类型错误
      expect(validator.validate({ query: 123 }, flatSchema).valid).toBe(false)
      // 范围错误
      expect(validator.validate({ query: 'x', topK: 100 }, flatSchema).valid).toBe(false)
      // 通过
      expect(validator.validate({ query: 'hello' }, flatSchema).valid).toBe(true)
      expect(validator.validate({ query: 'hello', topK: 5 }, flatSchema).valid).toBe(true)
    })

    test('enum 校验仍工作', () => {
      const enumSchema = {
        type: { type: 'string', enum: ['docx', 'xlsx', 'md'], required: true },
        filename: { type: 'string', required: true }
      }
      expect(validator.validate({ type: 'docx', filename: 'a.docx' }, enumSchema).valid).toBe(true)
      expect(validator.validate({ type: 'pdf', filename: 'a.pdf' }, enumSchema).valid).toBe(false)
    })

    test('array minItems/maxItems 仍工作', () => {
      const arrSchema = {
        items: { type: 'array', minItems: 1, maxItems: 3, required: true }
      }
      expect(validator.validate({ items: [] }, arrSchema).valid).toBe(false)
      expect(validator.validate({ items: ['a'] }, arrSchema).valid).toBe(true)
      expect(validator.validate({ items: ['a', 'b', 'c', 'd'] }, arrSchema).valid).toBe(false)
    })
  })

  describe('edge cases', () => {
    test('schema 为 null/undefined 时不报错', () => {
      expect(validator.validate({}, null).valid).toBe(true)
      expect(validator.validate({}, undefined).valid).toBe(true)
    })

    test('args 为 null/undefined 时不报错', () => {
      const schema = { name: { type: 'string', required: true } }
      expect(validator.validate(null, schema).valid).toBe(false)
      expect(validator.validate(undefined, schema).valid).toBe(false)
    })

    test('嵌套格式但没有 required 字段时不校验必填', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      }
      expect(validator.validate({}, schema).valid).toBe(true)
      expect(validator.validate({ name: 'x' }, schema).valid).toBe(true)
    })
  })
})