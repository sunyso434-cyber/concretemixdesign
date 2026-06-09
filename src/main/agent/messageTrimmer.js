/**
 * 消息 token 截断
 *
 * 策略：system prompt + 最新 2 轮必保留；中间 tool result 优先丢
 * 解决 P1-2：JSON 安全截断（先 parse，按子项截）
 * 解决 P1-3：reasoning_content 计入 token
 */

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

  // 构建 assistant → tool 的父子关系索引
  // key: assistant 消息在 messages 中的 index, value: 属于该 assistant 的 tool 消息 indices
  const toolToParent = new Map() // tool index → assistant index
  let lastAssistantIdx = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'assistant' && messages[i].tool_calls) {
      lastAssistantIdx = i
    }
    if (messages[i].role === 'tool') {
      toolToParent.set(i, lastAssistantIdx)
    }
  }

  // 2. 中间：排除 system 和 lastRounds
  const reservedSet = new Set([system, ...lastRounds].filter(Boolean))
  const middle = messages.filter(m => !reservedSet.has(m))

  // 记录每条消息在原始数组中的位置，用于最后恢复正确顺序
  // DeepSeek API 要求 tool 消息必须出现在对应的 assistant(tool_calls) 之后
  const origIndexMap = new Map()
  for (let i = 0; i < messages.length; i++) {
    origIndexMap.set(messages[i], i)
  }

  // 3. 累计 token
  const reserved = [system, ...lastRounds].filter(Boolean)
  let totalTokens = reserved.reduce((sum, m) => sum + estimateTokens(m), 0)

  const kept = [...reserved]
  // 记录已保留的原始消息索引
  const keptOrigIndices = new Set()
  for (const m of reserved) {
    const origIdx = messages.indexOf(m)
    if (origIdx >= 0) keptOrigIndices.add(origIdx)
  }

  for (let i = middle.length - 1; i >= 0; i--) {
    const m = middle[i]
    const origIdx = messages.indexOf(m)
    const tokens = estimateTokens(m)

    if (totalTokens + tokens > tokenBudget) {
      // 超出预算：tool 消息尝试截断，非 tool 消息丢弃
      if (m.role === 'tool') {
        const maxChars = Math.floor((tokenBudget - totalTokens) * CHARS_PER_TOKEN_ZH)
        if (maxChars > 100) {
          const truncated = (m.content || '').startsWith('{') || (m.content || '').startsWith('[')
            ? safeTruncateJson(m.content, maxChars)
            : safeTruncateString(m.content, maxChars)
          kept.push({ ...m, content: truncated })
          totalTokens += Math.ceil(truncated.length / CHARS_PER_TOKEN_ZH)
          if (origIdx >= 0) keptOrigIndices.add(origIdx)
        }
        // 否则丢
      }
      // 其他类型不截，直接丢
    } else {
      kept.push(m)
      totalTokens += tokens
      if (origIdx >= 0) keptOrigIndices.add(origIdx)
    }
  }

  // 4. 后处理：确保所有 tool 消息的父 assistant 也在 kept 中
  // 如果 tool 的父 assistant 被丢掉了，需要补回来，否则 API 400
  for (let i = 0; i < kept.length; i++) {
    const msg = kept[i]
    if (msg.role === 'tool') {
      // 查找该 tool 在原 messages 中的索引，然后在 kept 中找到或添加其父 assistant
      const origToolIdx = messages.findIndex(
        om => om.role === 'tool' && om.tool_call_id === msg.tool_call_id && om.content === msg.content
      )
      if (origToolIdx >= 0) {
        const parentIdx = toolToParent.get(origToolIdx)
        if (parentIdx >= 0 && !keptOrigIndices.has(parentIdx)) {
          // 父 assistant 不在 kept 中，需要添加
          const parentMsg = messages[parentIdx]
          // 在 tool 消息之前插入父 assistant
          const keptInsertAt = i // 在当前 tool 之前
          kept.splice(keptInsertAt, 0, parentMsg)
          keptOrigIndices.add(parentIdx)
          totalTokens += estimateTokens(parentMsg)
          i++ // 跳过刚插入的 assistant
        }
      }
    }
  }

  // 4.5 按原始顺序排序：修复 push() 拼装导致的 tool/assistant 顺序错乱
  // DeepSeek API 硬性要求 tool 消息在对应 assistant(tool_calls) 之后
  kept.sort((a, b) => (origIndexMap.get(a) ?? Infinity) - (origIndexMap.get(b) ?? Infinity))

  errorHandler.warn('truncate', { originalCount: messages.length, keptCount: kept.length, totalTokens })
  return kept
}

module.exports = { trim, estimateTokens }