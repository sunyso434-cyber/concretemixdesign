/**
 * v0.9.x 一致性修复：dedupeToolMessages 单元测试
 */
const { dedupeToolMessages } = require('../agentStoreCore')

const assistantWithToolTimeline = {
  id: 1, role: 'assistant', content: '正在计算...',
  timeline: [{ type: 'reasoning' }, { type: 'tool', toolName: 'list_available_materials', status: 'done' }],
}
const assistantNoTimeline = { id: 2, role: 'assistant', content: '好的', timeline: [] }
const toolMsg = { id: 3, role: 'tool', content: '{"success":true}' }
const userMsg = { id: 4, role: 'user', content: '再算一个' }

describe('dedupeToolMessages', () => {
  test('非数组原样返回', () => {
    expect(dedupeToolMessages(null)).toBeNull()
    expect(dedupeToolMessages(undefined)).toBeUndefined()
  })

  test('assistant timeline 含工具块时隐藏其后的 tool 消息', () => {
    const out = dedupeToolMessages([assistantWithToolTimeline, toolMsg])
    expect(out.map(m => m.role)).toEqual(['assistant'])
  })

  test('assistant timeline 无工具块时保留 tool 消息（老会话）', () => {
    const out = dedupeToolMessages([assistantNoTimeline, toolMsg])
    expect(out.map(m => m.role)).toEqual(['assistant', 'tool'])
  })

  test('纯文本 assistant + tool 消息保留；user 消息重置状态', () => {
    const out = dedupeToolMessages([assistantWithToolTimeline, toolMsg, userMsg, assistantNoTimeline, toolMsg])
    expect(out.map(m => m.role)).toEqual(['assistant', 'user', 'assistant', 'tool'])
  })

  test('多轮交替正确配对', () => {
    const out = dedupeToolMessages([
      assistantWithToolTimeline, toolMsg, assistantNoTimeline, toolMsg, toolMsg,
    ])
    expect(out.map(m => m.role)).toEqual(['assistant', 'assistant', 'tool', 'tool'])
  })

  test('user/system/error 消息不受影响', () => {
    const out = dedupeToolMessages([userMsg, { role: 'system', content: 'x' }, toolMsg])
    expect(out).toHaveLength(3)
  })
})
