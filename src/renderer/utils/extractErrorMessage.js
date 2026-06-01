/**
 * 从各种错误格式中安全提取错误消息字符串
 * 防止 ErrorCodes 对象 {code, message, hint, recovery} 被直接渲染导致 React #31
 *
 * @param {*} error - 任意格式的错误（string / ErrorCodes 对象 / Error 对象 / null）
 * @param {string} fallback - 默认兜底文案
 * @returns {string} 错误消息字符串
 */
export default function extractErrorMessage(error, fallback = '未知错误') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    // ErrorCodes 格式: { code, message, hint, recovery }
    if (error.message) return String(error.message)
    if (error.error) return String(error.error)
    // 兜底序列化
    try { return JSON.stringify(error) } catch { return fallback }
  }
  return String(error)
}
