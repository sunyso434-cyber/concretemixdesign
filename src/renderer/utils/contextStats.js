// src/renderer/utils/contextStats.js
/**
 * contextStats - 上下文统计纯函数工具
 *
 * 职责：
 * 1. estimateTextTokens / estimateTokens - 估算文本与 messages 的 token 数
 *    （CJK 字符按 1 字 ≈ 1 token，其他字符按 4 字符 ≈ 1 token；
 *      旧版统一 4 字符 ≈ 1 token 对中文低估约 3~4 倍，导致上下文圆环显示偏低）
 * 2. getContextPercent - 计算已用上下文比例（优先 realTokens，降级估算）
 * 3. messagesToText - 把 messages 数组拼成 LLM 可读文本
 *
 * 不依赖任何外部状态（无 IO、无副作用），可在渲染层和测试中自由调用。
 *
 * 注意：主进程使用 src/shared/utils/contextStats.js（CJS 版本），
 *       本文件是渲染层 ESM 版本，逻辑完全一致。
 */

export const DEFAULT_CONTEXT_LIMIT = 800000
const CHARS_PER_TOKEN = 4
const CJK_TOKENS_PER_CHAR = 1

// CJK 统一汉字 + 扩展A + 中文标点 + 全角符号
const CJK_CHAR_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/

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
 * 估算单段文本的 token 数（中英混合口径）
 * @param {string} text
 * @returns {number}
 */
export function estimateTextTokens(text) {
  if (!text) return 0
  let cjkCount = 0
  let otherCount = 0
  for (const ch of text) {
    if (CJK_CHAR_REGEX.test(ch)) cjkCount++
    else otherCount++
  }
  return Math.ceil(cjkCount * CJK_TOKENS_PER_CHAR + otherCount / CHARS_PER_TOKEN)
}

/**
 * 估算 messages 数组的总 token 数
 * @param {Array<{role, content}>} messages
 * @returns {number}
 */
export function estimateTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0
  const text = messages.map(m => extractContent(m)).join('')
  return estimateTextTokens(text)
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
