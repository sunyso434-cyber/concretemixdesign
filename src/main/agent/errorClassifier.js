// src/main/agent/errorClassifier.js
// 错误分类器 - 上游适配器
// 把任意 error 对象归类为标准错误代码（AI_ERROR_REGISTRY lookup）
// 仅主进程调用；渲染端禁止 import（IPC 序列化会丢失 response/code/status 字段）
const { createError, AI_ERROR_REGISTRY } = require('./ErrorCodes')

/**
 * 错误分类器 - 把任意 error 对象归类为标准错误代码
 * 按优先级顺序匹配，**首次命中即返回**
 * 策略顺序：1（结构化）→ 2（HTTP status）→ 3（网络 code）→ 4（字面量）→ 5（关键词）→ 6（兜底）
 * 注：字面量匹配优先于关键词匹配，因为字面量是 AI 内部状态的精确信号，
 *     权威性高于模糊匹配。例如 message='max_failures_exceeded: context length exceeded'
 *     时先命中字面量 → E-AGENT-001（而非关键词 E-LLM-413）。
 *
 * @param {Error | object | string | null | undefined} rawError 原始错误
 * @param {object} context 上下文 { callSite, requestId, sessionId, ... }
 * @returns {{ success:false, code, title, hint, recovery, details }} 标准错误结构
 */
function classifyError(rawError, context = {}) {
  // 策略 1：已结构化错误（DeepSeekService 直接 throw 出来的 {code,message,hint,details}）
  // code 已经在 registry 里 → 完全交给 createError() 走 registry lookup，
  // 不传 caller 的 message/hint（保证 title/hint 来自 registry 权威值）
  if (rawError && typeof rawError === 'object' && rawError.code && AI_ERROR_REGISTRY[rawError.code]) {
    return createError(rawError.code, null, null, {
      ...(rawError.details || {}),
      requestId: context.requestId,
      sessionId: context.sessionId,
      occurredAt: new Date().toISOString(),
    })
  }

  // 策略 2：HTTP 状态码（axios 错误 → response.status）
  const status = rawError && rawError.response && rawError.response.status
  if (status) {
    const httpToCode = {
      400: 'E-LLM-400',
      401: 'E-LLM-401',
      402: 'E-LLM-402',
      403: 'E-LLM-403',
      413: 'E-LLM-413',
      429: 'E-LLM-429',
      500: 'E-LLM-500',
      503: 'E-LLM-503',
    }
    const code = httpToCode[status] || 'E-LLM-500'
    return buildPayload(code, rawError, context)
  }

  // 策略 3：网络错误代码（axios error.code 字段）
  if (rawError && rawError.code && typeof rawError.code === 'string') {
    if (rawError.code === 'ECONNABORTED') return buildPayload('E-NET-408', rawError, context)
    if (['ENOTFOUND', 'ECONNREFUSED', 'ERR_NETWORK', 'ETIMEDOUT', 'ECONNRESET'].includes(rawError.code)) return buildPayload('E-NET-500', rawError, context)
  }

  const msg = getMessage(rawError)

  // 策略 4：字面量匹配（AI 内部状态精确信号，权威性高于关键词）
  if (msg === 'max_failures_exceeded' || msg.startsWith('max_failures_exceeded:')) {
    return buildPayload('E-AGENT-001', rawError, context)
  }
  if (msg === 'max_steps_exceeded') {
    return buildPayload('E-AGENT-002', rawError, context)
  }
  if (msg === 'wc_destroyed') {
    return buildPayload('E-SYS-001', rawError, context)
  }

  // 策略 5：关键词匹配
  if (
    msg.includes('context length') ||
    msg.includes('maximum tokens') ||
    msg.includes('context_length_exceeded')
  ) {
    return buildPayload('E-LLM-413', rawError, context)
  }

  // 策略 6：兜底 E-SYS-999
  return buildPayload('E-SYS-999', rawError, context)
}

/**
 * 安全地从 rawError 提取 message 字符串
 */
function getMessage(rawError) {
  if (rawError == null) return ''
  if (typeof rawError === 'string') return rawError
  return rawError.message || rawError.toString() || ''
}

/**
 * 构造错误 payload（包含 details 上下文 + 脱敏 + 截断）
 */
function buildPayload(code, rawError, context) {
  const msg = getMessage(rawError)
  const status = rawError && rawError.response && rawError.response.status
  let details = {
    rawMessage: msg,
    httpStatus: status,
    callSite: context.callSite,
    requestId: context.requestId,
    sessionId: context.sessionId,
    occurredAt: new Date().toISOString(),
  }
  if (rawError && rawError.stack) details.stack = rawError.stack
  if (rawError && rawError.response && rawError.response.data) details.responseData = rawError.response.data

  // 脱敏先于截断（避免大字段先被截断再脱敏导致 token 漏掉）
  details = sanitizeDetails(details)
  details = truncateDetails(details)
  return createError(code, null, null, details)
}

/**
 * 脱敏敏感字段 - 在截断之前进行
 * - apiKey / api_key / Authorization 字段值替换为 '***'
 * - 任何以 'Bearer ' 开头的字符串值替换为 'Bearer ***'
 */
function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return details
  const result = {}
  for (const [k, v] of Object.entries(details)) {
    if (['apiKey', 'api_key', 'Authorization'].includes(k)) {
      result[k] = '***'
    } else if (typeof v === 'string' && v.startsWith('Bearer ')) {
      result[k] = 'Bearer ***'
    } else {
      result[k] = v
    }
  }
  return result
}

const SOFT_LIMIT = 2 * 1024   // 单字段软截断 2KB
const HARD_LIMIT = 50 * 1024  // 整体硬截断 50KB

/**
 * 两级截断：
 * - 单字段超 2KB 软截断（带 ...）
 * - 整个 details 超 50KB 硬截断（替换为 _truncated 元信息）
 */
function truncateDetails(details) {
  if (!details || typeof details !== 'object') return details
  // v8.3.8: 用 try/catch 兜底循环引用 / BigInt / Symbol 等不可序列化场景
  // axios 错误 response.data 可能是 stream，含 TLSSocket.parser.socket 循环引用 → JSON.stringify 抛 TypeError
  // 兜底为 0：走软截断路径而非抛错，不破坏现有逻辑
  let totalSize = 0
  try {
    totalSize = JSON.stringify(details).length
  } catch (_) {
    totalSize = 0
  }
  if (totalSize > HARD_LIMIT) {
    return {
      _truncated: true,
      originalSize: totalSize,
      reason: 'Details 超过 50KB 硬上限已截断',
    }
  }
  const result = {}
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string' && v.length > SOFT_LIMIT) {
      result[k] = v.slice(0, SOFT_LIMIT) + '...'
    } else {
      result[k] = v
    }
  }
  return result
}

module.exports = { classifyError, sanitizeDetails, truncateDetails }