const { buildSystemPrompt } = require('../systemPromptBuilder')

describe('systemPromptBuilder', () => {
  test('应输出包含角色定义的字符串', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['skill_a', 'skill_b'],
      agentMdRules: ''
    })
    expect(prompt).toContain('混凝土配合比')
  })

  test('应注入技能列表', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['query_material', 'calculate_ratio'],
      agentMdRules: ''
    })
    expect(prompt).toContain('query_material')
    expect(prompt).toContain('calculate_ratio')
  })

  test('应注入记忆上下文（如有）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '用户偏好 42.5 水泥',
      skillNames: [],
      agentMdRules: ''
    })
    expect(prompt).toContain('用户偏好 42.5 水泥')
  })

  test('空 skillNames 不应崩溃', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      agentMdRules: ''
    })
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  test('agentMdRules 应注入到"用户自定义规则"章节', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      agentMdRules: '## 回复风格\n- 语气：非常专业\n- 称呼：王工'
    })
    expect(prompt).toContain('非常专业')
    expect(prompt).toContain('王工')
    expect(prompt).toContain('用户自定义规则')
  })

  test('agentMdRules 超过 4KB 应追加截断警告', () => {
    const big = 'x'.repeat(5000)
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      agentMdRules: big
    })
    expect(prompt).toContain('截断')
  })

  test('总长度超 4000 字符应追加 token 警告', () => {
    const bigMemory = 'y'.repeat(3000)
    const bigRules = 'z'.repeat(1500)
    const prompt = buildSystemPrompt({
      memoryContext: bigMemory,
      skillNames: [],
      agentMdRules: bigRules
    })
    expect(prompt).toContain('token')
  })
})

describe('buildSystemPrompt 注入 preferenceSummary', () => {
  test('应把 preferenceSummary 嵌入用户偏好段落', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '历史摘要',
      skillNames: ['calculate_mix_design'],
      agentMdRules: '规则',
      preferenceSummary: '- 选材：水泥厂家偏好拉法基\n- 计算方法：体积法'
    })
    expect(prompt).toContain('- 选材：水泥厂家偏好拉法基')
    expect(prompt).toContain('- 计算方法：体积法')
  })

  test('preferenceSummary 为空时不应输出该段落', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).not.toContain('# 用户偏好')
  })

  test('preferenceSummary 非空时应有独立小标题', () => {
    const prompt = buildSystemPrompt({ preferenceSummary: '- 计算方法：体积法' })
    expect(prompt).toContain('# 用户偏好')
    expect(prompt).toContain('- 计算方法：体积法')
  })
})
