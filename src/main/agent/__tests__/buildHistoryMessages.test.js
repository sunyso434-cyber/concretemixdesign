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
    expect(msgs[1]).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1' }]
    })
    expect(msgs[2]).toMatchObject({
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
})
