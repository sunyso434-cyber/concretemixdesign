/**
 * 消息 token 截断
 *
 * 策略：system prompt + 最新 2 轮必保留；中间 tool result 优先丢
 * 解决 P1-2：JSON 安全截断（先 parse，按子项截）
 * 解决 P1-3：reasoning_content 计入 token
 */

const eventBus = require('./EventBus')
const errorHandler = require('../utils/errorHandler')

const CHARS_PER_TOKEN_ZH = 1.5  // 中文 1.5 token/字

function estimateTokens(msg) {
  let chars = (msg.content || '').length
  if (msg.reasoning_content) {
    chars += msg.reasoning_content.length
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ZH)
}

function safeTruncateString(str, maxChars) {
  // 按段落截断（避免截在引号/大括号中间）
  const truncated = str.slice(0, maxChars)
  const lastParagraph = truncated.lastIndexOf('\n\n')
  if (lastParagraph > maxChars * 0.5) {
    return truncated.slice(0, lastParagraph) + '\n\n[... 已截断 ...]'
  }
  return truncated + '\n\n[... 已截断 ...]'
}

function safeTruncateJson(content, maxChars) {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      // 截断 array 子项
      const truncated = parsed.slice(0, 10).map(item =>
        typeof item === 'string' ? item.slice(0, 200) : JSON.stringify(item).slice(0, 200)
      )
      return JSON.stringify({ truncated: true, originalLength: parsed.length, sample: truncated })
    }
    return JSON.stringify({ truncated: true, keys: Object.keys(parsed).slice(0, 10) })
  } catch (e) {
    return safeTruncateString(content, maxChars)
  }
}

function trim(messages, { tokenBudget = 30000 } = {}) {
  if (messages.length === 0) return messages

  // 1. 必保留：system + 最后 2 轮（user/assistant 对，跳过 tool）
  const system = messages.find(m => m.role === 'system')
  // 从尾部找最近的非 tool 非 system 消息作为"最后 2 轮"（最多 4 条 = 2 轮 user+assistant）
  const lastRounds = []
  for (let i = messages.length - 1; i >= 0 && lastRounds.length < 4; i--) {
    if (messages[i].role !== 'tool' && messages[i].role !== 'system') {
      lastRounds.unshift(messages[i])
    }
  }

  // 2. 中间：排除 system 和 lastRounds
  const reservedSet = new Set([system, ...lastRounds].filter(Boolean))
  const middle = messages.filter(m => !reservedSet.has(m))

  // 3. 累计 token
  const reserved = [system, ...lastRounds].filter(Boolean)
  let totalTokens = reserved.reduce((sum, m) => sum + estimateTokens(m), 0)

  const kept = [...reserved]
  for (let i = middle.length - 1; i >= 0; i--) {
    const m = middle[i]
    const tokens = estimateTokens(m)
    if (totalTokens + tokens > tokenBudget) {
      // 截断这条
      if (m.role === 'tool') {
        const maxChars = Math.floor((tokenBudget - totalTokens) * CHARS_PER_TOKEN_ZH)
        if (maxChars > 100) {
          const truncated = (m.content || '').startsWith('{') || (m.content || '').startsWith('[')
            ? safeTruncateJson(m.content, maxChars)
            : safeTruncateString(m.content, maxChars)
          kept.splice(1, 0, { ...m, content: truncated })
          totalTokens += Math.ceil(truncated.length / CHARS_PER_TOKEN_ZH)
        }
        // 否则丢
      }
      // 其他类型不截，直接丢
    } else {
      kept.splice(1, 0, m)
      totalTokens += tokens
    }
  }

  errorHandler.warn('truncate', { originalCount: messages.length, keptCount: kept.length, totalTokens })
  return kept
}

module.exports = { trim, estimateTokens }
