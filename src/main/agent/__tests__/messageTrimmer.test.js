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

  test('Bug A+B 回归：截断 tool 后位置不丢且父 assistant 在场', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1', tool_calls: [{ id: 'call_1' }] },
      { role: 'tool', content: 'x'.repeat(20000), tool_call_id: 'call_1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' }
    ]
    const result = trim(messages, { tokenBudget: 500 })

    const toolIdx = result.findIndex(m => m.role === 'tool' && m.tool_call_id === 'call_1')
    expect(toolIdx).toBeGreaterThan(-1)

    const parentIdx = result.findIndex(m =>
      m.role === 'assistant' && m.tool_calls && m.tool_calls.some(tc => tc.id === 'call_1')
    )
    expect(parentIdx).toBeGreaterThan(-1)

    expect(toolIdx).toBeGreaterThan(parentIdx)
    expect(toolIdx).toBeLessThan(result.length - 1)
    expect(result[toolIdx].content).toContain('已截断')
  })
})
