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

    for (const [key, schema] of Object.entries(parameters)) {
      const value = argsObj[key]

      // 检查必填参数
      if (schema.required && (value === undefined || value === null)) {
        errors.push({
          param: key,
          errorCode: ErrorCodes.PARAM_MISSING,
          message: `缺少必填参数: ${key}`,
          hint: schema.description || `请提供 ${key}`
        })
        continue
      }

      // 跳过可选的空值
      if (value === undefined || value === null) continue

      // 检查类型
      if (!this._checkType(value, schema.type)) {
        errors.push({
          param: key,
          errorCode: ErrorCodes.PARAM_INVALID_TYPE,
          message: `参数 ${key} 类型错误: 期望 ${schema.type}，实际 ${typeof value}`,
          hint: schema.description
        })
        continue
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
    for (const [key, value] of Object.entries(parameters)) {
      properties[key] = {
        type: value.type,
        description: value.description || ''
      }
      if (value.items) properties[key].items = value.items
      if (value.enum) properties[key].enum = value.enum
      if (value.examples) properties[key].examples = value.examples
      if (value.min !== undefined) properties[key].minimum = value.min
      if (value.max !== undefined) properties[key].maximum = value.max
    }
    return properties
  }
}

module.exports = SchemaValidator
