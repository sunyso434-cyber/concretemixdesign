// src/renderer/utils/__tests__/contextStats.test.js
// 直接测试共享层源码（CJS），避免经过 renderer ESM 中转
const {
  estimateTokens,
  estimateTextTokens,
  getContextPercent,
  messagesToText,
  DEFAULT_CONTEXT_LIMIT
} = require('../../../shared/utils/contextStats')

describe('estimateTokens', () => {
  test('空数组返回 0', () => {
    expect(estimateTokens([])).toBe(0)
  })

  test('空字符串 content 返回 0', () => {
    expect(estimateTokens([{ role: 'user', content: '' }])).toBe(0)
  })

  test('单条短消息', () => {
    // "hello" = 5 字符，5/4 = 1.25 → 2 (ceil)
    expect(estimateTokens([{ role: 'user', content: 'hello' }])).toBe(2)
  })

  test('多条消息累加', () => {
    const messages = [
      { role: 'user', content: 'hello' },           // 5 字符
      { role: 'assistant', content: 'world' }       // 5 字符
    ]
    // 总 10 字符 / 4 = 2.5 → 3 (ceil)
    expect(estimateTokens(messages)).toBe(3)
  })

  test('中文 content', () => {
    // 新口径：汉字按 1 字 ≈ 1 token，"你好" = 2 tokens
    expect(estimateTokens([{ role: 'user', content: '你好' }])).toBe(2)
  })

  test('中英混合按各自口径累加', () => {
    // "你好hi" = 2 汉字(2) + 2 字符(ceil(2/4)=1) = 3
    expect(estimateTokens([{ role: 'user', content: '你好hi' }])).toBe(3)
  })

  test('estimateTextTokens 纯 ASCII 与旧口径一致', () => {
    // "hello" = 5/4 → ceil = 2
    expect(estimateTextTokens('hello')).toBe(2)
  })

  test('estimateTextTokens 中文标点与全角符号按 CJK 计', () => {
    // "你好！" = 3 个 CJK 字符（含全角叹号）→ 3
    expect(estimateTextTokens('你好！')).toBe(3)
  })

  test('content 是数组（卡片）时拼接所有 text 字段', () => {
    const messages = [{
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' }
      ]
    }]
    // 10 字符 / 4 = 3 (ceil)
    expect(estimateTokens(messages)).toBe(3)
  })
})

describe('getContextPercent', () => {
  test('空 messages 返回 0', () => {
    expect(getContextPercent({ messages: [] })).toBe(0)
  })

  test('realTokens 优先', () => {
    const result = getContextPercent({
      realTokens: 400000,
      messages: [{ role: 'user', content: 'hello' }],
      contextLimit: 800000
    })
    // 400000 / 800000 = 0.5
    expect(result).toBe(0.5)
  })

  test('realTokens 为 0 或 null 时降级到估算', () => {
    const result = getContextPercent({
      realTokens: null,
      messages: [{ role: 'user', content: 'a'.repeat(8000) }],  // 2000 tokens
      contextLimit: 800000
    })
    // 2000 / 800000 = 0.0025
    expect(result).toBeCloseTo(0.0025, 4)
  })

  test('结果 clamp 到 [0, 1]', () => {
    expect(getContextPercent({ realTokens: 1000000, messages: [], contextLimit: 800000 })).toBe(1)
    expect(getContextPercent({ realTokens: -1, messages: [], contextLimit: 800000 })).toBe(0)
  })

  test('contextLimit 默认 800000', () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBe(800000)
    const result = getContextPercent({ realTokens: 400000, messages: [] })
    expect(result).toBe(0.5)
  })
})

describe('messagesToText', () => {
  test('拼接 user/assistant 文本', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]
    const result = messagesToText(messages)
    expect(result).toBe('[user]\nhi\n\n[assistant]\nhello')
  })

  test('空数组返回空字符串', () => {
    expect(messagesToText([])).toBe('')
  })

  test('跳过 _compacted 为 true 的消息', () => {
    const messages = [
      { role: 'user', content: 'old', _compacted: true },
      { role: 'user', content: 'new' }
    ]
    expect(messagesToText(messages)).toBe('[user]\nnew')
  })

  test('content 是数组时提取所有 text 字段', () => {
    const messages = [{
      role: 'assistant',
      content: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' }
      ]
    }]
    expect(messagesToText(messages)).toBe('[assistant]\npart1\npart2')
  })
})