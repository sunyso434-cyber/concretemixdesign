/**
 * 4 级错误处理器
 *
 * 位置：src/main/utils/（不放在 agent/ 下，因为 LearningService / agentHandler init 也用）
 *
 * 解决 P1-1：加 errorSource 字段
 * 解决 P3-3：与 Promise.allSettled 配合，降级走 warn:resource_fallback
 */

const eventBus = require('../agent/EventBus')

function emit(channel, errorSource, payload) {
  try {
    eventBus.emit(channel, { errorSource, timestamp: Date.now(), ...payload })
  } catch (e) {
    // 内部 emit 失败也不应抛出
    console.error('[errorHandler] emit failed:', e.message)
  }
}

module.exports = {
  fatal(errorSource, payload = {}) {
    emit('error:fatal', errorSource, payload)
  },
  error(errorSource, payload = {}) {
    emit(`error:${errorSource}`, errorSource, payload)
  },
  warn(errorSource, payload = {}) {
    emit(`warn:${errorSource}`, errorSource, payload)
  },
  silent(errorSource, payload = {}) {
    // 故意不 emit
  }
}
