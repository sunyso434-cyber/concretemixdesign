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
  MEMORY_SAVE_FAILED: 'MEMORY_SAVE_FAILED',
  WC_DESTROYED: 'WC_DESTROYED',
  TIMEOUT_RETRY_EXHAUSTED: 'TIMEOUT_RETRY_EXHAUSTED',
  RATE_LIMIT_EXHAUSTED: 'RATE_LIMIT_EXHAUSTED',

  // ===== 转发函数引用（兼容对象方法调用形式）=====
  // 见下方 createError / _getRecoveryStrategy 的模块作用域函数定义；
  // 这里挂回对象上，让 `ErrorCodes.createError(...)` 这种老用法继续 work。
  createError,        // eslint-disable-line no-undef
  _getRecoveryStrategy // eslint-disable-line no-undef
}

/**
 * AI 错误编码注册表 - 19 条编码（spec 2.2 节定义）
 * 用于 classifyError / createError 自动补全 title/hint/recovery
 */
const AI_ERROR_REGISTRY = {
  'E-LLM-400': { title: 'AI 请求格式错误', hint: '请重试一次；若反复出现请联系开发', recovery: 'retry', severity: 'error' },
  'E-LLM-401': { title: 'AI 密钥无效或未配置', hint: '请到「设置」→「AI 模型」检查 API Key 是否填错或过期', recovery: 'fix_settings', severity: 'error' },
  'E-LLM-402': { title: 'AI 账户余额不足', hint: '请前往 DeepSeek 控制台充值后重试', recovery: 'recharge', severity: 'error' },
  'E-LLM-403': { title: 'AI 接口无访问权限', hint: '当前账号无此模型权限，请联系开发或更换模型', recovery: 'change_model', severity: 'error' },
  'E-LLM-413': { title: '内容超限（超过最大 token 数）', hint: '输入或对话历史过长，请新建会话或精简提问后重试', recovery: 'trim_input', severity: 'error' },
  'E-LLM-429': { title: 'AI 请求频率超限', hint: '稍等 1-2 分钟后重试', recovery: 'wait_retry', severity: 'error' },
  'E-LLM-500': { title: 'AI 服务端错误', hint: 'DeepSeek 服务异常，请稍后重试', recovery: 'wait_retry', severity: 'error' },
  'E-LLM-503': { title: 'AI 服务暂不可用', hint: 'DeepSeek 维护中，请稍后重试', recovery: 'wait_retry', severity: 'error' },
  'E-NET-408': { title: '网络请求超时', hint: '请检查网络连接后重试', recovery: 'check_network', severity: 'error' },
  'E-NET-500': { title: '网络连接失败', hint: '无法连接到 AI 服务器，请检查网络或代理设置', recovery: 'check_network', severity: 'error' },
  'E-AGENT-001': { title: 'AI 连续失败次数超限', hint: 'AI 多次尝试均失败，请检查任务描述或换种说法', recovery: 'rephrase', severity: 'error' },
  'E-AGENT-002': { title: 'AI 执行步数超限', hint: '任务过于复杂，请拆分为更小的步骤', recovery: 'split_task', severity: 'error' },
  'E-PARSE-001': { title: 'AI 返回的 JSON 解析失败', hint: 'AI 输出格式异常，请重试一次', recovery: 'retry', severity: 'error' },
  'E-PARSE-002': { title: 'AI 流式响应中断', hint: '流式数据不完整，请重试', recovery: 'retry', severity: 'error' },
  'E-SKILL-001': { title: '未找到对应工具', hint: 'AI 调用了不存在的工具，请联系开发', recovery: 'silent', severity: 'error' },
  'E-SKILL-002': { title: '工具执行失败', hint: '工具执行出错，请查看详情或重试', recovery: 'retry', severity: 'error' },
  'E-SKILL-003': { title: '工具参数校验失败', hint: 'AI 提供的参数不符合要求，请重试一次', recovery: 'retry', severity: 'error' },
  'E-SYS-001': { title: '应用窗口已关闭', hint: '内部错误，通常无需处理', recovery: 'silent', severity: 'error' },
  'E-SYS-999': { title: '未知错误（兜底）', hint: '请复制错误信息发给开发协助排查', recovery: 'silent', severity: 'error' },
}

/**
 * 根据错误码获取恢复策略（兼容老 API）
 * @param {string} code - 错误码
 * @returns {string} 恢复策略
 */
function _getRecoveryStrategy(code) {
  // 优先看 AI_ERROR_REGISTRY（含 spec 2.2 节 21 条 AI 编码的 recovery）
  if (AI_ERROR_REGISTRY[code] && AI_ERROR_REGISTRY[code].recovery) {
    return AI_ERROR_REGISTRY[code].recovery
  }
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
    UNKNOWN: 'retry',
    MEMORY_SAVE_FAILED: 'skip',
    WC_DESTROYED: 'silent',
    TIMEOUT_RETRY_EXHAUSTED: 'fail',
    RATE_LIMIT_EXHAUSTED: 'fail',
  }
  return strategies[code] || 'retry'
}

/**
 * 创建标准错误响应
 * - 若 caller 显式传 message / hint（老用法），用 caller 的；
 * - 否则若 code 在 AI_ERROR_REGISTRY 里，用 registry 的 title/hint/recovery 自动补全；
 * - 都未匹配则用 _getRecoveryStrategy(code) 兼容老 API。
 *
 * 返回字段（spec 3.3 数据契约）：
 *   code     - 错误码字符串（'E-LLM-401' 等）
 *   title    - 用户可读的标题/消息（caller 传 message 或 registry 命中时；未注册且无 message 时为 undefined）
 *   hint     - 恢复建议
 *   recovery - 恢复策略标识符
 *   details  - 详细信息
 *   success  - 固定 false
 *
 * 不再有 `error` / `errorCode` 别名 —— spec 约束 "AI_ERROR_REGISTRY 是 createError() 的 lookup table，
 * 不能引入并列体系"。渲染器请改读 `.title`，测试请改读 `.code`。
 *
 * @param {string} code - 错误码
 * @param {string} message - 错误消息（caller 显式传入时优先；等同 title 字段）
 * @param {string} hint - 恢复建议
 * @param {object} details - 详细信息
 * @returns {object} 标准错误响应
 */
function createError(code, message, hint, details = null) {
  const registry = AI_ERROR_REGISTRY[code] || {}
  const resolvedTitle = message || registry.title
  return {
    success: false,
    code,
    title: resolvedTitle,
    hint: hint || registry.hint || undefined,
    recovery: registry.recovery || _getRecoveryStrategy(code),
    details: details || {},
  }
}

// 把模块作用域函数挂到 module.exports 上，保持 `ErrorCodes.createError(...)` 老用法可用
module.exports.createError = createError
module.exports._getRecoveryStrategy = _getRecoveryStrategy
module.exports.AI_ERROR_REGISTRY = AI_ERROR_REGISTRY
