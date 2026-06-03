const { buildMDInstruction } = require('../mdInstructionBuilder')

describe('mdInstructionBuilder', () => {
  const skill = {
    name: 'test_skill',
    _mdBody: '用户 {{user}}_{{user_id}} 在 {{time}} 查询 {{material_type}}'
  }

  test('应一次性替换所有占位符（不受 args 顺序影响）', () => {
    const result = buildMDInstruction(skill, { user: 'A', user_id: '42', time: '10点', material_type: '水泥' })
    // 测试目的是验证占位符替换正确性（不受 args 顺序影响），用 toContain 验证 body
    expect(result).toContain('用户 A_42 在 10点 查询 水泥')
  })

  test('应一次性替换所有占位符（key 倒序传入也不影响）', () => {
    const result = buildMDInstruction(skill, { material_type: '水泥', time: '10点', user_id: '42', user: 'A' })
    // 测试目的是验证占位符替换正确性（不受 args 顺序影响），用 toContain 验证 body
    expect(result).toContain('用户 A_42 在 10点 查询 水泥')
  })

  test('args 缺 key 时模板里占位符原样保留', () => {
    const result = buildMDInstruction(skill, { user: 'A' })
    expect(result).toContain('{{user_id}}')
    expect(result).toContain('{{time}}')
    expect(result).toContain('{{material_type}}')
  })

  test('args 缺 key 时返回的指令不应是空', () => {
    const result = buildMDInstruction(skill, {})
    expect(result).toContain('用户 {{user}}')
  })

  test('应包一层"子任务"提示', () => {
    const result = buildMDInstruction(skill, { user: 'A', user_id: '42', time: '10点', material_type: '水泥' })
    expect(result).toContain('子任务')
    expect(result).toContain('test_skill')
  })

  test('value 应被 String() 强转', () => {
    const result = buildMDInstruction(skill, { user: 123, user_id: true, time: null, material_type: undefined })
    // null 和 undefined 应该被替换成字符串"null"/"undefined"——这是当前实现行为
    // 如需改为原样保留，加开关（当前 spec 行为）
    expect(result).toContain('123')
  })
})
