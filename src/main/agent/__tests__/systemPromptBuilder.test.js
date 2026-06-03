const { buildSystemPrompt } = require('../systemPromptBuilder')

describe('systemPromptBuilder', () => {
  test('应输出包含角色定义的字符串', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['skill_a', 'skill_b'],
      preferences: {}
    })
    expect(prompt).toContain('混凝土配合比')
  })

  test('应注入技能列表', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['query_material', 'calculate_ratio'],
      preferences: {}
    })
    expect(prompt).toContain('query_material')
    expect(prompt).toContain('calculate_ratio')
  })

  test('应注入记忆上下文（如有）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '用户偏好 42.5 水泥',
      skillNames: [],
      preferences: {}
    })
    expect(prompt).toContain('用户偏好 42.5 水泥')
  })

  test('空 skillNames 不应崩溃', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      preferences: {}
    })
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })
})
