/**
 * v0.9.x 轨迹功能：trajectorySteps 单元测试
 */
const {
  buildTrajectorySteps,
  filterTrajectorySteps,
  trajectoryStatusLabel,
} = require('../trajectorySteps')

const mkMsg = (id, timeline, extra = {}) => ({
  id, role: 'assistant', content: '回复内容', timeline, stats: { elapsedMs: 15000 }, ...extra,
})

describe('buildTrajectorySteps', () => {
  test('空消息返回空数组', () => {
    expect(buildTrajectorySteps(null)).toEqual([])
    expect(buildTrajectorySteps([])).toEqual([])
  })

  test('无 timeline 的 assistant 消息跳过（不算回合）', () => {
    const out = buildTrajectorySteps([
      { id: 1, role: 'user', content: 'hi' },
      { id: 2, role: 'assistant', content: 'ok', timeline: [] },
    ])
    expect(out).toEqual([])
  })

  test('timeline 展平为步骤并编号回合', () => {
    const out = buildTrajectorySteps([
      mkMsg(1, [
        { type: 'reasoning', content: '思考1', status: 'done' },
        { type: 'tool', toolName: 'list_available_materials', args: { type: '粉煤灰' }, result: { count: 7 }, status: 'done' },
      ]),
      mkMsg(2, [
        { type: 'tool', toolName: 'calculate_mix_design', args: { strength: 'C30' }, result: { success: true }, status: 'done' },
      ]),
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ turn: 1, type: 'reasoning', content: '思考1' })
    expect(out[1]).toMatchObject({ turn: 1, type: 'tool', toolName: 'list_available_materials', args: { type: '粉煤灰' }, result: { count: 7 } })
    expect(out[2]).toMatchObject({ turn: 2, toolName: 'calculate_mix_design' })
  })
})

describe('filterTrajectorySteps', () => {
  const steps = [
    { key: 'a', type: 'reasoning', content: '先查材料', status: 'done' },
    { key: 'b', type: 'tool', toolName: 'list_available_materials', args: { type: '粉煤灰' }, result: { count: 7 }, status: 'done' },
    { key: 'c', type: 'tool', toolName: 'calculate_mix_design', args: { strength: 'C30' }, result: { success: false, error: '材料不存在' }, status: 'error' },
  ]

  test('filter 类型过滤', () => {
    expect(filterTrajectorySteps(steps, '', 'tool').map(s => s.key)).toEqual(['b', 'c'])
    expect(filterTrajectorySteps(steps, '', 'reasoning').map(s => s.key)).toEqual(['a'])
    expect(filterTrajectorySteps(steps, '', 'failed').map(s => s.key)).toEqual(['c'])
    expect(filterTrajectorySteps(steps, '', 'all')).toHaveLength(3)
  })

  test('query 搜索工具名/参数/结果', () => {
    expect(filterTrajectorySteps(steps, 'calculate', 'all').map(s => s.key)).toEqual(['c'])
    expect(filterTrajectorySteps(steps, '粉煤灰', 'all').map(s => s.key)).toEqual(['b'])
    expect(filterTrajectorySteps(steps, 'C30', 'all').map(s => s.key)).toEqual(['c'])
    expect(filterTrajectorySteps(steps, '不存在', 'all').map(s => s.key)).toEqual(['c'])
  })

  test('多词搜索需全部命中；无查询返回全部', () => {
    expect(filterTrajectorySteps(steps, 'list 粉煤灰', 'all').map(s => s.key)).toEqual(['b'])
    expect(filterTrajectorySteps(steps, 'list 不存在', 'all')).toEqual([])
    expect(filterTrajectorySteps(steps, '', 'all')).toHaveLength(3)
  })
})

describe('trajectoryStatusLabel', () => {
  test('状态中文标签', () => {
    expect(trajectoryStatusLabel('running')).toBe('执行中')
    expect(trajectoryStatusLabel('error')).toBe('失败')
    expect(trajectoryStatusLabel('done')).toBe('完成')
  })
})
