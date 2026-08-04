/**
 * P0 断点续跑单元测试（Task 1.4/1.5/1.6）
 *
 * 覆盖：
 * - detectCrashWindow 5 种形态（spec 7.1）
 * - rerunUnpairedToolCalls 串行重跑 + 落库 + metadata.rerun
 * - restoreCheckpoint 恢复 todo 快照 + lastStep
 */

// mock todo-manage 的 restoreFromSnapshot
jest.mock('../../skills/todo-manage', () => ({
  restoreFromSnapshot: jest.fn(),
  execute: jest.fn()
}))

// mock db/database 避免 native module 崩溃（AgentMemoryService require 时加载 sequelize）
const mockDb = {
  ChatHistory: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn(), count: jest.fn() },
  CorrectionRule: { create: jest.fn(), findAll: jest.fn(), destroy: jest.fn() },
  ChatSession: { findOne: jest.fn(), destroy: jest.fn(), create: jest.fn() },
  SessionSummary: { destroy: jest.fn() },
  PreferenceSuggestion: {},
  AgentCheckpoint: null
}
jest.mock('../../db/database', () => mockDb)

const todoManage = require('../../skills/todo-manage')
const AgentMemoryService = require('../../services/AgentMemoryService')

describe('AgentMemoryService.detectCrashWindow (Task 1.4) - 5 种形态', () => {
  let mem

  beforeEach(() => {
    mem = Object.create(AgentMemoryService)
    // mock getRecentHistory，各测试用例覆盖
    mem.getRecentHistory = jest.fn()
  })

  // 形态 1：空历史 → needAsk=false
  test('① 空历史 → needAsk=false', async () => {
    mem.getRecentHistory.mockResolvedValue([])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(false)
    expect(r.unpairedToolCalls).toEqual([])
  })

  // 形态 2：最后一条 assistant 无 tool_calls → needAsk=false
  test('② 最后一条 assistant 无 tool_calls → needAsk=false', async () => {
    mem.getRecentHistory.mockResolvedValue([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', toolCalls: null }
    ])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(false)
  })

  // 形态 3：最后一条 assistant tool_calls 全配对 → needAsk=false
  test('③ 最后一条 assistant tool_calls 全配对 → needAsk=false', async () => {
    mem.getRecentHistory.mockResolvedValue([
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', function: { name: 'foo', arguments: '{}' } }] },
      { role: 'tool', content: 'result', toolCallId: 'tc1' }
    ])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(false)
  })

  // 形态 4：最后一条 assistant 有未配对 tool_calls → needAsk=true，返回所有未配对
  // 场景：assistant 发了 3 个 tool_calls，系统一个都没执行就崩了（最后一条是 assistant）
  test('④ 最后一条 assistant 有未配对 tool_calls → needAsk=true', async () => {
    mem.getRecentHistory.mockResolvedValue([
      { role: 'tool', content: 'old result', toolCallId: 'tc0' },  // 之前的工具结果
      { role: 'assistant', content: '', toolCalls: [
        { id: 'tc1', function: { name: 'foo', arguments: '{}' } },
        { id: 'tc2', function: { name: 'bar', arguments: '{}' } },
        { id: 'tc3', function: { name: 'baz', arguments: '{}' } }
      ]}
      // 没有 tool 消息跟在后面——3 个 tool_calls 全部未配对（崩溃：工具一个都没执行）
    ])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(true)
    expect(r.unpairedToolCalls).toHaveLength(3)
    expect(r.unpairedToolCalls.map(tc => tc.id)).toEqual(['tc1', 'tc2', 'tc3'])
  })

  // 形态 5：最后一条是 tool → needAsk=false
  test('⑤ 最后一条是 tool → needAsk=false', async () => {
    mem.getRecentHistory.mockResolvedValue([
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', function: { name: 'foo', arguments: '{}' } }] },
      { role: 'tool', content: 'result', toolCallId: 'tc1' }
    ])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(false)
  })

  // 形态 6：最后一条是 user → needAsk=false
  test('⑥ 最后一条是 user → needAsk=false', async () => {
    mem.getRecentHistory.mockResolvedValue([
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: '继续' }
    ])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(false)
  })

  // toolCalls 是字符串（DB JSON 字段）也能正确解析
  test('⑦ toolCalls 为字符串 → 正确解析', async () => {
    mem.getRecentHistory.mockResolvedValue([
      { role: 'assistant', content: '', toolCalls: JSON.stringify([{ id: 'tc1', function: { name: 'foo', arguments: '{}' } }]) }
    ])
    const r = await mem.detectCrashWindow('s1')
    expect(r.needAsk).toBe(true)
    expect(r.unpairedToolCalls).toHaveLength(1)
  })
})

describe('AgentMemoryService.rerunUnpairedToolCalls (Task 1.5)', () => {
  let mem
  let mockSkillExecutor

  beforeEach(() => {
    mem = Object.create(AgentMemoryService)
    mem.saveMessage = jest.fn().mockResolvedValue({})
    mockSkillExecutor = { execute: jest.fn() }
  })

  test('① 3 个未配对 tool_calls → 串行执行 3 次 → 3 条 tool 消息落库', async () => {
    mockSkillExecutor.execute
      .mockResolvedValueOnce({ success: true, data: 'r1' })
      .mockResolvedValueOnce({ success: true, data: 'r2' })
      .mockResolvedValueOnce({ success: true, data: 'r3' })

    const unpaired = [
      { id: 'tc1', function: { name: 'foo', arguments: '{"a":1}' } },
      { id: 'tc2', function: { name: 'bar', arguments: '{"b":2}' } },
      { id: 'tc3', function: { name: 'baz', arguments: '{}' } }
    ]

    const results = await mem.rerunUnpairedToolCalls('s1', unpaired, { skillExecutor: mockSkillExecutor })

    expect(results).toHaveLength(3)
    expect(mockSkillExecutor.execute).toHaveBeenCalledTimes(3)
    // 验证串行调用参数
    expect(mockSkillExecutor.execute).toHaveBeenNthCalledWith(1, 'foo', { a: 1 }, { sessionId: 's1' })
    expect(mockSkillExecutor.execute).toHaveBeenNthCalledWith(2, 'bar', { b: 2 }, { sessionId: 's1' })
    // 验证落库 3 次，metadata.rerun=true
    expect(mem.saveMessage).toHaveBeenCalledTimes(3)
    expect(mem.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'tool',
      toolCallId: 'tc1',
      metadata: expect.objectContaining({ rerun: true })
    }))
  })

  test('② 工具执行抛异常 → 记录失败结果，继续执行下一个', async () => {
    mockSkillExecutor.execute
      .mockRejectedValueOnce(new Error('skill crash'))
      .mockResolvedValueOnce({ success: true })

    const unpaired = [
      { id: 'tc1', function: { name: 'foo', arguments: '{}' } },
      { id: 'tc2', function: { name: 'bar', arguments: '{}' } }
    ]

    const results = await mem.rerunUnpairedToolCalls('s1', unpaired, { skillExecutor: mockSkillExecutor })

    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(false)
    expect(results[1].success).toBe(true)
    // 失败的工具也落库
    expect(mem.saveMessage).toHaveBeenCalledTimes(2)
  })

  test('③ 空数组 → 返回空结果，不调 skillExecutor', async () => {
    const results = await mem.rerunUnpairedToolCalls('s1', [], { skillExecutor: mockSkillExecutor })
    expect(results).toEqual([])
    expect(mockSkillExecutor.execute).not.toHaveBeenCalled()
  })
})

describe('AgentMemoryService.restoreCheckpoint (Task 1.6)', () => {
  let mem

  beforeEach(() => {
    mem = Object.create(AgentMemoryService)
    jest.clearAllMocks()
    mockDb.AgentCheckpoint = null
  })

  test('① 有 checkpoint → 恢复 todo 快照 + 返回 lastStep', async () => {
    mockDb.AgentCheckpoint = {
      findOne: jest.fn().mockResolvedValue({
        lastStep: 5,
        todoSnapshot: JSON.stringify([{ content: 'task1', status: 'pending' }])
      })
    }

    const result = await mem.restoreCheckpoint('s1')

    expect(result.lastStep).toBe(5)
    expect(result.todoSnapshot).toHaveLength(1)
    expect(result.todoSnapshot[0].content).toBe('task1')
    expect(todoManage.restoreFromSnapshot).toHaveBeenCalledWith('s1', result.todoSnapshot)
  })

  test('② 无 checkpoint → lastStep=0，todoSnapshot=[]', async () => {
    mockDb.AgentCheckpoint = { findOne: jest.fn().mockResolvedValue(null) }

    const result = await mem.restoreCheckpoint('s1')

    expect(result.lastStep).toBe(0)
    expect(result.todoSnapshot).toEqual([])
    expect(todoManage.restoreFromSnapshot).not.toHaveBeenCalled()
  })

  test('③ todoSnapshot 为空数组 → 不调 restoreFromSnapshot', async () => {
    mockDb.AgentCheckpoint = {
      findOne: jest.fn().mockResolvedValue({ lastStep: 3, todoSnapshot: '[]' })
    }

    const result = await mem.restoreCheckpoint('s1')

    expect(result.lastStep).toBe(3)
    expect(result.todoSnapshot).toEqual([])
    expect(todoManage.restoreFromSnapshot).not.toHaveBeenCalled()
  })
})
