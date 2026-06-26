/**
 * buildHistoryMessages 回归测试 — spec 8.1
 * 验证 toolCalls 链路完整性 + 末尾孤立 user 移除（防止后续回归）
 *
 * 跑法：npx jest src/main/agent/__tests__/buildHistoryMessages.test.js
 *
 * Mock 层级说明：
 * - mock 的是 ChatHistory.findAll（最底层）
 * - 真实链路：getHistory → findAll(DESC) → messages.reverse() → buildHistoryMessages
 * - 因此 mock 必须按"findAll 返回的 DESC 顺序"给数据
 *   （即最新消息在前），让 getHistory.reverse() 翻回时间正序
 */

jest.mock('../../db/database', () => ({
  ChatHistory: {
    findAll: jest.fn(),
    create: jest.fn()
  }
}))

const AgentMemoryService = require('../../services/AgentMemoryService')
const { ChatHistory } = require('../../db/database')

describe('buildHistoryMessages (spec 8.1 回归测试)', () => {
  beforeEach(() => jest.clearAllMocks())

  test('tool_calls 链路完整（assistant 带 tool_calls + tool 响应带 tool_call_id）', async () => {
    // 时间正序应为: [user, assistant(tool_calls), tool(tool_call_id)]
    // mock 给 DESC 顺序（最新在前），getHistory.reverse() 翻回正序
    ChatHistory.findAll.mockResolvedValue([
      { role: 'tool', content: '{"result":1}', toolCallId: 'call_1', toolCalls: null, metadata: null },
      { role: 'assistant', content: null, toolCallId: null, toolCalls: JSON.stringify([{ id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{}' } }]), metadata: null },
      { role: 'user', content: '帮我算C30', toolCallId: null, toolCalls: null, metadata: null }
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')

    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '帮我算C30' })
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{}' } }]
    })
    expect(msgs[2]).toEqual({
      role: 'tool',
      content: '{"result":1}',
      tool_call_id: 'call_1'
    })
  })

  test('末尾孤立 user 消息自动移除（避免 LLM 回答过时问题）', async () => {
    // 时间正序: [user(第一条), assistant(已回答), user(第二条未回答)]
    // mock 给 DESC: 最新 user 在前
    ChatHistory.findAll.mockResolvedValue([
      { role: 'user', content: '第二条未回答', toolCallId: null, toolCalls: null, metadata: null },
      { role: 'assistant', content: '已回答', toolCallId: null, toolCalls: null, metadata: null },
      { role: 'user', content: '第一条', toolCallId: null, toolCalls: null, metadata: null }
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')

    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('第一条')
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '已回答' })
  })

  test('toolCalls 字段为字符串时正确解析', async () => {
    ChatHistory.findAll.mockResolvedValue([
      { role: 'assistant', content: null, toolCallId: null, toolCalls: '[{"id":"a"}]', metadata: null }
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')
    expect(msgs[0].tool_calls).toEqual([{ id: 'a' }])
  })

  test('空历史返回空数组', async () => {
    ChatHistory.findAll.mockResolvedValue([])
    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')
    expect(msgs).toEqual([])
  })

  test('assistant 无 content 无 toolCalls 视为非法（content 留空字符串）', async () => {
    ChatHistory.findAll.mockResolvedValue([
      { role: 'assistant', content: null, toolCallId: null, toolCalls: null, metadata: null }
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].content).toBe('')
  })

  // === v8.4.x 新增：tool 消息孤儿救援（防止 DeepSeek API 400） ===
  // DeepSeek API 规则：role='tool' 消息必须紧跟在带 tool_calls 的 assistant 之后
  // 根因：数据库中 toolCalls 字段可能为 null（老数据、空数组被存为 null 等），
  //      导致 buildHistoryMessages 输出"孤儿"tool 消息，LLM 返回 E-LLM-400
  // 修复：buildHistoryMessages 出口对 tool 消息做"父 assistant 补占位 + 孤儿丢弃"

  test('修复 1: assistant 缺 tool_calls 但后续有 tool(tool_call_id) → 补占位 tool_calls', async () => {
    // 时间正序: [user, assistant(只 content 无 tool_calls，模拟脏数据), tool(tool_call_id)]
    ChatHistory.findAll.mockResolvedValue([
      { role: 'tool', content: '{"result":1}', toolCallId: 'call_1', toolCalls: null, metadata: null },
      { role: 'assistant', content: '好的我来算', toolCallId: null, toolCalls: null, metadata: null },  // ← toolCalls=null（脏数据）
      { role: 'user', content: '帮我算C30', toolCallId: null, toolCalls: null, metadata: null }
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')

    expect(msgs).toHaveLength(3)
    // assistant 消息被补上占位 tool_calls
    expect(msgs[1]).toMatchObject({
      role: 'assistant',
      content: '好的我来算',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'unknown_recovered', arguments: '{}' }
      }]
    })
    // tool 消息保留
    expect(msgs[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
  })

  test('修复 2: session 第一条就是 tool 消息 → 丢弃孤儿', async () => {
    // 时间正序: [tool(tool_call_id), user, assistant]
    ChatHistory.findAll.mockResolvedValue([
      { role: 'assistant', content: '好的', toolCallId: null, toolCalls: null, metadata: null },
      { role: 'user', content: '继续', toolCallId: null, toolCalls: null, metadata: null },
      { role: 'tool', content: '{"r":1}', toolCallId: 'orphan_1', toolCalls: null, metadata: null }  // ← 第一条，无父
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')

    // 孤儿 tool 应被丢弃；末尾孤立 user 也应被移除
    expect(msgs).toHaveLength(2)
    expect(msgs.find(m => m.role === 'tool')).toBeUndefined()
    expect(msgs[0]).toMatchObject({ role: 'user', content: '继续' })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '好的' })
  })

  test('修复 3: 多个 tool 消息共用同一父 → 父 tool_calls 包含多个占位', async () => {
    // 时间正序: [user, assistant(无 tool_calls), tool(call_1), tool(call_2)]
    ChatHistory.findAll.mockResolvedValue([
      { role: 'tool', content: '{"r":1}', toolCallId: 'call_2', toolCalls: null, metadata: null },
      { role: 'tool', content: '{"r":2}', toolCallId: 'call_1', toolCalls: null, metadata: null },
      { role: 'assistant', content: '好的', toolCallId: null, toolCalls: null, metadata: null },
      { role: 'user', content: '帮我做两件事', toolCallId: null, toolCalls: null, metadata: null }
    ])

    const msgs = await AgentMemoryService.buildHistoryMessages('sess-1')

    expect(msgs).toHaveLength(4)
    expect(msgs[1].tool_calls).toHaveLength(2)
    const ids = msgs[1].tool_calls.map(tc => tc.id).sort()
    expect(ids).toEqual(['call_1', 'call_2'])
  })
})
