/**
 * 参数自动验证器
 * 根据 Skill 定义的 parameters 自动验证参数类型、必填、范围
 */

const ErrorCodes = require('./ErrorCodes')

class SchemaValidator {
  /**
   * 验证参数
   * @param {object} args - 实际传入的参数
   * @param {object} parameters - Skill 定义的参数 schema
   * @returns {object} 验证结果 { valid, errorCode, errorMessage, hint, details }
   */
  validate(args, parameters) {
    const errors = []
    const argsObj = args || {}

    // 防御：parameters 为 null/undefined 时直接视为通过（避免 Object.entries 报错）
    if (!parameters || typeof parameters !== 'object') {
      return { valid: true }
    }

    // v9.1.0 修复：识别 JSON Schema 嵌套格式（type='object' + properties + required）
    // - 旧逻辑直接 Object.entries(parameters)，会把 'type'/'properties'/'required' 当字段校验 → bypass
    // - 新逻辑优先按嵌套格式解析；如无 properties/required 则按 flat schema 校验（向后兼容）
    const isNestedSchema = parameters && typeof parameters === 'object'
      && parameters.type === 'object'
      && parameters.properties && typeof parameters.properties === 'object'

    if (isNestedSchema) {
      // JSON Schema 嵌套格式：递归校验 properties
      const flatProperties = parameters.properties
      const requiredList = Array.isArray(parameters.required) ? parameters.required : []

      // 先校验必填
      for (const key of requiredList) {
        const value = argsObj[key]
        if (value === undefined || value === null || value === '') {
          const schema = flatProperties[key] || {}
          errors.push({
            param: key,
            errorCode: ErrorCodes.PARAM_MISSING,
            message: `缺少必填参数: ${key}`,
            hint: schema.description || `请提供 ${key}`
          })
        }
      }

      // 再校验每个字段
      for (const [key, schema] of Object.entries(flatProperties)) {
        const value = argsObj[key]
        this._validateField(key, value, schema, errors)
      }
    } else {
      // flat schema 格式（顶层直接是字段定义）
      for (const [key, schema] of Object.entries(parameters)) {
        const value = argsObj[key]
        this._validateField(key, value, schema, errors)
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errorCode: errors[0].errorCode,
        errorMessage: errors.map(e => e.message).join('; '),
        hint: errors.map(e => e.hint).filter(Boolean).join('; '),
        details: { errors }
      }
    }

    return { valid: true }
  }

  /**
   * 校验单个字段（flat 和 nested 格式共用）
   * @param {string} key - 字段名
   * @param {*} value - 字段值
   * @param {object} schema - 字段 schema
   * @param {Array} errors - 错误累积数组（直接 push）
   */
  _validateField(key, value, schema, errors) {
    if (!schema || typeof schema !== 'object') return

    // 检查必填（flat schema 用 schema.required，nested schema 已在 validate() 里统一校验过）
    if (schema.required && (value === undefined || value === null)) {
      errors.push({
        param: key,
        errorCode: ErrorCodes.PARAM_MISSING,
        message: `缺少必填参数: ${key}`,
        hint: schema.description || `请提供 ${key}`
      })
      return
    }

    // 跳过可选的空值（undefined/null）
    if (value === undefined || value === null) return

    // 检查类型
    if (schema.type && !this._checkType(value, schema.type)) {
      errors.push({
        param: key,
        errorCode: ErrorCodes.PARAM_INVALID_TYPE,
        message: `参数 ${key} 类型错误: 期望 ${schema.type}，实际 ${typeof value}`,
        hint: schema.description
      })
      return
    }

    // 检查范围 (数值类型)
    if (schema.type === 'number' || schema.type === 'integer') {
      if (schema.min !== undefined && value < schema.min) {
        errors.push({
          param: key,
          errorCode: ErrorCodes.PARAM_OUT_OF_RANGE,
          message: `参数 ${key} 不能小于 ${schema.min}，当前值: ${value}`,
          hint: schema.description
        })
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push({
          param: key,
          errorCode: ErrorCodes.PARAM_OUT_OF_RANGE,
          message: `参数 ${key} 不能大于 ${schema.max}，当前值: ${value}`,
          hint: schema.description
        })
      }
    }

    // 检查数组长度
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push({
          param: key,
          errorCode: ErrorCodes.PARAM_OUT_OF_RANGE,
          message: `参数 ${key} 至少需要 ${schema.minItems} 个元素，当前 ${value.length} 个`,
          hint: schema.description
        })
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push({
          param: key,
          errorCode: ErrorCodes.PARAM_OUT_OF_RANGE,
          message: `参数 ${key} 最多 ${schema.maxItems} 个元素，当前 ${value.length} 个`,
          hint: schema.description
        })
      }
    }

    // 检查枚举值
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        param: key,
        errorCode: ErrorCodes.PARAM_OUT_OF_RANGE,
        message: `参数 ${key} 必须是以下值之一: ${schema.enum.join(', ')}`,
        hint: schema.description
      })
    }
  }

  /**
   * 类型检查
   * @param {*} value - 值
   * @param {string} type - 期望类型
   * @returns {boolean} 是否匹配
   */
  _checkType(value, type) {
    switch (type) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && !isNaN(value)
      case 'integer':
        return Number.isInteger(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'array':
        return Array.isArray(value)
      case 'object':
        return typeof value === 'object' && !Array.isArray(value)
      default:
        return true
    }
  }

  /**
   * 从参数 schema 提取必填参数列表
   * @param {object} parameters - 参数 schema
   * @returns {string[]} 必填参数名列表
   */
  getRequiredParams(parameters) {
    return Object.entries(parameters)
      .filter(([_, v]) => v.required)
      .map(([k]) => k)
  }

  /**
   * 将参数 schema 转换为 JSON Schema 格式 (给 LLM 用)
   * @param {object} parameters - 参数 schema
   * @returns {object} JSON Schema properties
   */
  toJsonSchemaProperties(parameters) {
    const properties = {}
    // ponytail: parameters 可能是 undefined（skill 未声明参数），防御性兜底
    if (!parameters || typeof parameters !== 'object') return properties
    // ponytail: OpenAI/DeepSeek 只接受这 6 种 JSON Schema 类型；其他（含项目自定义 'select'/'range'/'switch'）兜底成 'string'，防御 schema 报错
    const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])

    // ponytail: 递归清洗嵌套 schema（items.properties/properties 内部不能再含 'required'/'default' 这类项目自定义字段；只对 items.properties 自身与外层 required 数组生效）
    const clean = (v) => {
      if (!v || typeof v !== 'object') return v
      const out = { ...v }
      if (out.type && !JSON_SCHEMA_TYPES.has(out.type)) out.type = 'string'
      delete out.required  // 项目自定义标记位：必填项应通过外层 required 数组表达
      delete out.default   // 项目自定义标记位：DeepSeek 协议不接受 default
      if (out.items && typeof out.items === 'object') out.items = clean(out.items)
      if (out.properties && typeof out.properties === 'object') {
        const cleanedProps = {}
        for (const [k, val] of Object.entries(out.properties)) cleanedProps[k] = clean(val)
        out.properties = cleanedProps
      }
      return out
    }

    for (const [key, value] of Object.entries(parameters)) {
      const c = clean(value)
      properties[key] = { type: c.type, description: c.description || '' }
      if (c.items) properties[key].items = c.items
      if (c.enum) properties[key].enum = c.enum
      if (c.examples) properties[key].examples = c.examples
      if (c.min !== undefined) properties[key].minimum = c.min
      if (c.max !== undefined) properties[key].maximum = c.max
      if (c.properties) properties[key].properties = c.properties
    }
    return properties
  }
}

module.exports = SchemaValidator
