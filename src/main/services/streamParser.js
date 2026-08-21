// ========== 内联思考解析器（MiniMax M3 等厂商） ==========
// 某些厂商不走 reasoning_content 独立字段，而是把  thinking...response 混在 content 正文里。
// 此解析器在流式阶段就把它们分离成 reasoning / text 事件，让后续链路无需感知厂商差异。
// 从 DeepSeekService.js 拆分（优化项 2），行为不变，供 deepSeekApiClient 的流式解析使用。

/**
 * 检查字符串末尾是否是不完整的  thinking 起始标签
 * 例：'xxx<th' → 返回 3, 'xxx<thin' → 返回 5
 */
function _partialStartTagLen(str) {
  const tag = ' thinking'
  for (let i = tag.length - 1; i >= 1; i--) {
    if (str.endsWith(tag.slice(0, i))) return i
  }
  return 0
}

/**
 * 检查字符串末尾是否是不完整的  response 结束标签
 */
function _partialEndTagLen(str) {
  const tag = ' response'
  for (let i = tag.length - 1; i >= 1; i--) {
    if (str.endsWith(tag.slice(0, i))) return i
  }
  return 0
}

/**
 * 把含  thinking 标签的 content chunk 拆成 reasoning / text 两部分
 * @param {string} chunk — 当前 chunk 的 delta.content
 * @param {{inThink: boolean, buffer: string}} state — 跨 chunk 状态
 * @returns {Array<{type: 'reasoning'|'text', content: string}>}
 */
function parseInlineThinking(chunk, state) {
  const text = state.buffer + chunk
  state.buffer = ''

  const results = []
  let pos = 0

  while (pos < text.length) {
    if (state.inThink) {
      // 当前在  thinking 块内，找  response
      const endIdx = text.indexOf(' response', pos)
      if (endIdx === -1) {
        // 没找到结束标签 → 剩余内容全是 thinking
        const remaining = text.slice(pos)
        const partialLen = _partialEndTagLen(remaining)
        if (partialLen > 0) {
          // 末尾可能是被截断的  response，先缓存起来
          results.push({ type: 'reasoning', content: remaining.slice(0, -partialLen) })
          state.buffer = remaining.slice(-partialLen)
        } else {
          results.push({ type: 'reasoning', content: remaining })
        }
        break
      } else {
        // 找到  response → 结束 thinking 模式
        results.push({ type: 'reasoning', content: text.slice(pos, endIdx) })
        pos = endIdx + 8 // 跳过 ' response'
        state.inThink = false
      }
    } else {
      // 当前在正文区域，找  thinking
      const startIdx = text.indexOf(' thinking', pos)
      if (startIdx === -1) {
        // 没找到起始标签 → 剩余内容全是正文
        const remaining = text.slice(pos)
        const partialLen = _partialStartTagLen(remaining)
        if (partialLen > 0) {
          // 末尾可能是被截断的  thinking，先缓存
          if (remaining.length > partialLen) {
            results.push({ type: 'text', content: remaining.slice(0, -partialLen) })
          }
          state.buffer = remaining.slice(-partialLen)
        } else {
          results.push({ type: 'text', content: remaining })
        }
        break
      } else {
        // 找到  thinking → 进入 thinking 模式
        if (startIdx > pos) {
          results.push({ type: 'text', content: text.slice(pos, startIdx) })
        }
        pos = startIdx + 7 // 跳过 ' thinking'
        state.inThink = true
      }
    }
  }

  return results.filter(r => r.content.length > 0)
}

module.exports = { parseInlineThinking, _partialStartTagLen, _partialEndTagLen }
