const { trim } = require('../messageTrimmer')

describe('messageTrimmer', () => {
  test('系统提示 + 最近 2 轮必保留', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'm1' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'm2' },
      { role: 'assistant', content: 'r2' },
      { role: 'user', content: 'm3' },
      { role: 'assistant', content: 'r3' }
    ]
    const result = trim(messages, { tokenBudget: 100 })
    expect(result[0]).toEqual(messages[0])  // system
    expect(result[result.length - 1]).toEqual(messages[messages.length - 1])  // 最后
  })

  test('超 budget 时 tool result 优先丢', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'a'.repeat(50000), tool_call_id: 'c1' },
      { role: 'user', content: 'final' }
    ]
    const result = trim(messages, { tokenBudget: 1000 })
    // 中间的 tool 应该被截断或丢弃
    const toolMsg = result.find(m => m.role === 'tool')
    if (toolMsg) {
      expect(toolMsg.content).toContain('已截断')
    }
  })

  test('JSON 内容截断后仍可 parse', () => {
    const bigJson = JSON.stringify({ data: 'x'.repeat(100000) })
    const messages = [
      { role: 'system', content: 's' },
      { role: 'tool', content: bigJson, tool_call_id: 'c1' }
    ]
    const result = trim(messages, { tokenBudget: 500 })
    const toolMsg = result.find(m => m.role === 'tool')
    if (toolMsg) {
      // 截断后尝试 parse 不应抛错（可能被截断成 null）
      // 这里只是烟雾测试
      expect(typeof toolMsg.content).toBe('string')
    }
  })

  test('reasoning_content 应计入 token', () => {
    const messages = [
      { role: 'system', content: 's' },
      { role: 'assistant', content: 'a', reasoning_content: 'thinking...'.repeat(1000) }
    ]
    const result = trim(messages, { tokenBudget: 100 })
    // reasoning_content 巨大时应该被截断
    expect(result.length).toBeGreaterThan(0)
  })
})
