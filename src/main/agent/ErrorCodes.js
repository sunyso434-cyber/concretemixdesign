/**
 * 统一错误码定义
 * 所有 Skill 和工具使用相同的错误码，LLM 可以根据错误码和 hint 自主修复调用
 */

module.exports = {
  // ===== 参数错误 =====
  PARAM_MISSING: 'PARAM_MISSING',
  PARAM_INVALID_TYPE: 'PARAM_INVALID_TYPE',
  PARAM_OUT_OF_RANGE: 'PARAM_OUT_OF_RANGE',
  PARAM_INVALID_FORMAT: 'PARAM_INVALID_FORMAT',

  // ===== Skill 错误 =====
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  SKILL_LOAD_FAILED: 'SKILL_LOAD_FAILED',
  SKILL_VALIDATION_FAILED: 'SKILL_VALIDATION_FAILED',

  // ===== 业务错误 =====
  MATERIAL_NOT_FOUND: 'MATERIAL_NOT_FOUND',
  CALCULATION_FAILED: 'CALCULATION_FAILED',
  COMPLIANCE_CHECK_FAILED: 'COMPLIANCE_CHECK_FAILED',
  OPTIMIZATION_FAILED: 'OPTIMIZATION_FAILED',
  QUOTE_GENERATION_FAILED: 'QUOTE_GENERATION_FAILED',

  // ===== 系统错误 =====
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',

  /**
   * 创建标准错误响应
   * @param {string} code - 错误码
   * @param {string} message - 错误消息
   * @param {string} hint - 恢复建议
   * @param {object} details - 详细信息
   * @returns {object} 标准错误响应
   */
  createError(code, message, hint, details = null) {
    return {
      success: false,
      error: message,
      errorCode: code,
      hint,
      recovery: this._getRecoveryStrategy(code),
      details
    }
  },

  /**
   * 根据错误码获取恢复策略
   * @param {string} code - 错误码
   * @returns {string} 恢复策略
   */
  _getRecoveryStrategy(code) {
    const strategies = {
      PARAM_MISSING: 'ask_user',
      PARAM_INVALID_TYPE: 'fix_params',
      PARAM_OUT_OF_RANGE: 'adjust_params',
      PARAM_INVALID_FORMAT: 'fix_params',
      SKILL_NOT_FOUND: 'list_skills',
      SKILL_LOAD_FAILED: 'check_config',
      MATERIAL_NOT_FOUND: 'list_materials',
      CALCULATION_FAILED: 'adjust_params',
      COMPLIANCE_CHECK_FAILED: 'review_design',
      OPTIMIZATION_FAILED: 'adjust_constraints',
      QUOTE_GENERATION_FAILED: 'check_pricing',
      SERVICE_UNAVAILABLE: 'retry',
      TIMEOUT: 'retry',
      UNKNOWN: 'retry'
    }
    return strategies[code] || 'retry'
  }
}
