// stub 掉 db 依赖避免加载 sqlite3 原生模块（与其他 AgentMemoryService 测试一致）
jest.mock('../../db/database', () => ({
  ChatHistory: { findAll: jest.fn(), create: jest.fn() }
}))

// 模块导出的是单例实例（module.exports = new AgentMemoryService()），取 .constructor 拿类
const AgentMemoryService = require('../../services/AgentMemoryService').constructor
const { ChatHistory } = require('../../db/database')

const makeSvc = () => {
  const svc = new AgentMemoryService()
  svc.saveMessage = jest.fn(async () => {})
  return svc
}

describe('AgentMemoryService.synthToolResults', () => {
  test('给未执行的 tool_call 合成 tool_result（带工具名）并返回消息数组', async () => {
    const svc = makeSvc()
    const toolCalls = [
      { id: 'a', function: { name: 'tool_a', arguments: '{}' } },
      { id: 'b', function: { name: 'tool_b', arguments: '{}' } }
    ]
    const msgs = await svc.synthToolResults('s1', toolCalls, new Set(['a']), 'steer')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    expect(msgs[0].tool_call_id).toBe('b')
    expect(JSON.parse(msgs[0].content)).toMatchObject({ success: false, interrupted_tool: 'tool_b' })
    expect(svc.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1', role: 'tool', toolCallId: 'b', metadata: { synth: true, reason: 'steer' }
    }))
  })

  test('已执行的 tool_call 全部跳过 → 返回空数组且不落库', async () => {
    const svc = makeSvc()
    const msgs = await svc.synthToolResults('s1', [{ id: 'a', function: { name: 't', arguments: '{}' } }], new Set(['a']))
    expect(msgs).toEqual([])
    expect(svc.saveMessage).not.toHaveBeenCalled()
  })

  test('非数组入参返回空数组', async () => {
    const svc = makeSvc()
    expect(await svc.synthToolResults('s1', null, new Set())).toEqual([])
    expect(await svc.synthToolResults('s1', undefined, new Set())).toEqual([])
  })

  test('saveMessage 失败时静默跳过但仍返回合成数组（内存不丢）', async () => {
    const svc = makeSvc()
    svc.saveMessage = jest.fn(async () => { throw new Error('db down') })
    const msgs = await svc.synthToolResults('s1', [{ id: 'x', function: { name: 't', arguments: '{}' } }], new Set())
    expect(msgs).toHaveLength(1)
  })
})

describe('buildHistoryMessages 兜底补合成（v3.1）', () => {
  beforeEach(() => jest.clearAllMocks())

  test('assistant 有未配对 tool_call → 在已有 tool 结果之后补合成', async () => {
    // 时间正序: [assistant(tool_calls A,B), tool(A 结果)] → DESC 顺序反之
    ChatHistory.findAll.mockResolvedValue([
      { role: 'tool', content: '{"ok":1}', toolCallId: 'A', toolCalls: null, metadata: null },
      { role: 'assistant', content: null, toolCallId: null,
        toolCalls: JSON.stringify([
          { id: 'A', type: 'function', function: { name: 'tA', arguments: '{}' } },
          { id: 'B', type: 'function', function: { name: 'tB', arguments: '{}' } }
        ]), metadata: null }
    ])
    const svc = new AgentMemoryService()
    const msgs = await svc.buildHistoryMessages('s1')
    // 顺序: assistant, tool(A), tool(B 合成)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[1]).toMatchObject({ role: 'tool', tool_call_id: 'A' })
    expect(msgs[2]).toMatchObject({ role: 'tool', tool_call_id: 'B', _synth: true })
  })

  test('全配对的 assistant 不补合成', async () => {
    ChatHistory.findAll.mockResolvedValue([
      { role: 'tool', content: '{"ok":1}', toolCallId: 'A', toolCalls: null, metadata: null },
      { role: 'assistant', content: null, toolCallId: null,
        toolCalls: JSON.stringify([{ id: 'A', type: 'function', function: { name: 'tA', arguments: '{}' } }]),
        metadata: null }
    ])
    const svc = new AgentMemoryService()
    const msgs = await svc.buildHistoryMessages('s1')
    expect(msgs).toHaveLength(2)
    expect(msgs.every(m => !m._synth)).toBe(true)
  })
})
