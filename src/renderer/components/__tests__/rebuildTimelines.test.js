/**
 * v0.9.x 一致性修复：rebuildTimelines 单元测试
 */
const { rebuildTimelines } = require('../agentStoreCore')

const assistantWithCalls = {
  id: 1, role: 'assistant', content: '开始计算',
  toolCalls: [
    { id: 'call_1', type: 'function', function: { name: 'list_available_materials', arguments: '{"type":"粉煤灰"}' } },
    { id: 'call_2', type: 'function', function: { name: 'calculate_mix_design', arguments: '{"strength":"C30"}' } },
  ],
}
const toolMsg1 = { id: 2, role: 'tool', toolCallId: 'call_1', content: '{"success":true,"count":7,"materials":[{"name":"I级粉煤灰"}]}' }
const toolMsg2 = { id: 3, role: 'tool', toolCallId: 'call_2', content: '{"success":true,"type":"mix_design","data":{"strength":"C30"}}' }
const assistantNoCalls = { id: 4, role: 'assistant', content: '完成' }
const userMsg = { id: 5, role: 'user', content: '再算一个' }

describe('rebuildTimelines', () => {
  test('空/非数组原样返回', () => {
    expect(rebuildTimelines(null)).toBeNull()
    expect(rebuildTimelines([])).toEqual([])
  })

  test('assistant 带 toolCalls + 后续 tool 消息 → 重建 timeline 并消费 tool 消息', () => {
    const out = rebuildTimelines([assistantWithCalls, toolMsg1, toolMsg2, assistantNoCalls])
    expect(out).toHaveLength(2)
    const rebuilt = out[0]
    expect(rebuilt._timelineRebuilt).toBe(true)
    expect(rebuilt.timeline).toHaveLength(2)
    expect(rebuilt.timeline[0]).toMatchObject({
      type: 'tool',
      toolName: 'list_available_materials',
      args: { type: '粉煤灰' },
      status: 'done',
      toolCallId: 'call_1',
    })
    // result 按 toolCallId 精确配对（JSON 字符串已解析为对象）
    expect(rebuilt.timeline[0].result).toMatchObject({ success: true, count: 7 })
    expect(rebuilt.timeline[1]).toMatchObject({ toolName: 'calculate_mix_design', toolCallId: 'call_2' })
    expect(rebuilt.timeline[1].result).toMatchObject({ type: 'mix_design' })
  })

  test('已有 timeline 的 assistant 不重建', () => {
    const withTimeline = { id: 1, role: 'assistant', content: 'x', timeline: [{ type: 'tool', toolName: 'a' }], toolCalls: [{ id: 'c1', function: { name: 'b' } }] }
    const out = rebuildTimelines([withTimeline])
    expect(out[0]._timelineRebuilt).toBeUndefined()
    expect(out[0].timeline).toEqual([{ type: 'tool', toolName: 'a' }])
  })

  test('无配对 tool 消息时 result 为 null，tool 消息单独保留', () => {
    const out = rebuildTimelines([assistantWithCalls, toolMsg1, toolMsg2])
    // 两条 tool 消息分别配对 call_1/call_2 → 全部消费
    expect(out).toHaveLength(1)
    expect(out[0].timeline[0].result).toMatchObject({ count: 7 })
    // 但若 tool 消息在 assistant 之前/无 assistant → 保留
    const orphan = rebuildTimelines([toolMsg1, assistantNoCalls])
    expect(orphan.map(m => m.role)).toEqual(['tool', 'assistant'])
  })

  test('参数 JSON 解析失败时 args 为 null', () => {
    const bad = { ...assistantWithCalls, toolCalls: [{ id: 'c9', function: { name: 'x', arguments: '{bad' } }] }
    const out = rebuildTimelines([bad, { id: 9, role: 'tool', toolCallId: 'c9', content: '{}' }])
    expect(out[0].timeline[0].args).toBeNull()
  })

  test('user 消息结算 pending，跨轮次正确', () => {
    const out = rebuildTimelines([assistantWithCalls, toolMsg1, userMsg, assistantNoCalls])
    expect(out.map(m => m.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(out[0].timeline).toHaveLength(2)
    // call_1 已配对；call_2 无对应 tool 消息（toolMsg2 不在本用例输入）→ result 为 null
    expect(out[0].timeline[0].result).toMatchObject({ count: 7 })
    expect(out[0].timeline[1].result).toBeNull()
  })
})
