// src/renderer/utils/contextStats.js
/**
 * contextStats - 上下文统计纯函数工具
 *
 * 职责：
 * 1. estimateTokens - 估算 messages 的 token 数（每 4 字符 ≈ 1 token）
 * 2. getContextPercent - 计算已用上下文比例（优先 realTokens，降级估算）
 * 3. messagesToText - 把 messages 数组拼成 LLM 可读文本
 *
 * 不依赖任何外部状态（无 IO、无副作用），可在渲染层和测试中自由调用。
 */

export const DEFAULT_CONTEXT_LIMIT = 800000
const CHARS_PER_TOKEN = 4

/**
 * 把单条 message 的 content 提取为字符串
 * 支持 string / array-of-parts 两种结构
 */
function extractContent(message) {
  if (!message || !message.content) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter(p => p && p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('\n')
  }
  return ''
}

/**
 * 估算 messages 数组的总 token 数
 * 用启发式：每 4 字符 ≈ 1 token
 * @param {Array<{role, content}>} messages
 * @returns {number} ceil(totalChars / 4)
 */
export function estimateTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0
  const totalChars = messages.reduce((sum, m) => sum + extractContent(m).length, 0)
  return Math.ceil(totalChars / CHARS_PER_TOKEN)
}

/**
 * 计算已用上下文比例
 * @param {object} input
 * @param {number|null|undefined} input.realTokens - 后端真实 tokens（优先）
 * @param {Array} input.messages - 前端 messages（realTokens 无值时降级）
 * @param {number} [input.contextLimit=800000] - 上下文上限
 * @returns {number} 0-1 范围（clamp 后）
 */
export function getContextPercent({ realTokens, messages, contextLimit = DEFAULT_CONTEXT_LIMIT }) {
  if (typeof realTokens === 'number' && realTokens > 0) {
    return Math.min(1, Math.max(0, realTokens / contextLimit))
  }
  const estimated = estimateTokens(messages || [])
  return Math.min(1, Math.max(0, estimated / contextLimit))
}

/**
 * 把 messages 数组拼成 LLM 可读文本
 * 跳过 _compacted 标志的消息（避免重复总结）
 * @param {Array} messages
 * @returns {string}
 */
export function messagesToText(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  return messages
    .filter(m => m && m.role && !m._compacted)
    .map(m => `[${m.role}]\n${extractContent(m)}`)
    .join('\n\n')
}