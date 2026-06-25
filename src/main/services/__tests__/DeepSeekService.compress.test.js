// src/main/services/__tests__/DeepSeekService.compress.test.js
// Task 4: DeepSeekService.compressContext 方法测试
const DeepSeekService = require('../DeepSeekService')

// Mock fetch
global.fetch = jest.fn()

// 构造长 user/assistant 文本，让 budget 装不下，强制 head 有内容
// 默认 budget = min(8000, max(2000, contextLimit*0.25))，对 contextLimit=800000 来说 = 8000
// 8000 token ≈ 32000 字符。我们构造 12 条 × 4000 字符 = 48000 字符 ≈ 12000 token
// 超过 budget，必然有 head 被压出来
function makeLongMessages(count) {
  const messages = []
  const longText = 'X'.repeat(4000) // 每条 4000 字符
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    messages.push({ role, content: `${role}-${i}-${longText}` })
  }
  return messages
}

describe('DeepSeekService.compressContext', () => {
  let service

  beforeEach(() => {
    service = new DeepSeekService('test-key')
    service._getConfig = jest.fn().mockResolvedValue({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      contextLimit: 800000
    })
    fetch.mockClear()
  })

  test('messages 少于 2 user 时抛错', async () => {
    await expect(
      service.compressContext([{ role: 'user', content: 'only' }], '')
    ).rejects.toThrow('对话过短，无需压缩')
  })

  test('空 messages 抛错', async () => {
    await expect(service.compressContext([], '')).rejects.toThrow()
  })

  test('成功路径：返回 summary + recentMessages + realTokens', async () => {
    // 6 个 user 轮，每条 2000 字符，总 12000 字符 ≈ 3000 token
    // budget=8000，能装前几轮但装不下全部，必然 head 有内容
    const messages = makeLongMessages(12)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '## Goal\n摘要内容' } }],
        usage: { total_tokens: 500 }
      })
    })

    const result = await service.compressContext(messages, '')

    expect(result.summary).toBe('## Goal\n摘要内容')
    expect(result.recentMessages).toBeInstanceOf(Array)
    expect(result.recentMessages.length).toBeGreaterThan(0)
    expect(result.realTokens).toBe(500)
  })

  test('summary 为空时抛错', async () => {
    const messages = makeLongMessages(12) // 至少 2 个 user
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' } }],
        usage: { total_tokens: 100 }
      })
    })

    await expect(service.compressContext(messages, '')).rejects.toThrow('AI 未返回有效摘要')
  })

  test('previousSummary 注入到 prompt', async () => {
    const messages = makeLongMessages(12)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '新摘要' } }],
        usage: { total_tokens: 200 }
      })
    })

    await service.compressContext(messages, '上次摘要内容')

    // 验证 fetch 调用时，user prompt 包含 "上次摘要"
    const fetchCall = fetch.mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    const userMsg = body.messages.find(m => m.role === 'user')
    expect(userMsg.content).toContain('上次摘要内容')
  })

  test('select 保留最近 N 轮：长对话中 recentMessages 包含最新 user', async () => {
    const messages = makeLongMessages(12) // 6 个 user 轮
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 's' } }],
        usage: { total_tokens: 100 }
      })
    })

    const result = await service.compressContext(messages, '')

    // recentMessages 应包含最新 user（最后一条 user，索引 10）
    const lastUser = messages.filter(m => m.role === 'user').slice(-1)[0]
    expect(result.recentMessages.some(m => m.content === lastUser.content)).toBe(true)
    // recentMessages 非空
    expect(result.recentMessages.length).toBeGreaterThan(0)
  })
})
