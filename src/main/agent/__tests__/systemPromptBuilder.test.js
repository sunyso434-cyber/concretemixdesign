const { buildSystemPrompt, REPORT_SKILL_MATRIX } = require('../systemPromptBuilder')

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

// Task 4.4：system prompt 注入 7 个 workspace 工具说明
// 验证 7 个工具名都出现在 prompt 中，LLM 才能知道怎么用
describe('buildSystemPrompt 注入 workspace 工具说明（Task 4.4）', () => {
  const EXPECTED_TOOLS = [
    'workspace_search',
    'workspace_readPage',
    'workspace_ingest',
    'workspace_writeFile',
    'workspace_listFiles',
    'workspace_lint',
    'workspace_searchGraph'
  ]

  test('7 个 workspace 工具名应全部出现在 system prompt', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['calculate_mix_design'],
      agentMdRules: ''
    })
    for (const name of EXPECTED_TOOLS) {
      expect(prompt).toContain(name)
    }
  })

  test('应包含 "workspace 工具说明" 小标题', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('workspace 工具说明')
  })

  test('应说明 LLM 优先 ingest 再 readPage 的工作流提示', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('ingest')
    expect(prompt).toContain('readPage')
    expect(prompt).toContain('wiki 摘要更精炼')
  })
})

// Task 4.3：5 类报告 → 必调 Skill 矩阵（v1.5.3 软约束）
// 软约束：LLM 看到后倾向按此顺序调用，可视情况跳过。
// 硬拦截不在 UnifiedStrategy 实现（避免破坏 LLM 自主性）。
describe('buildSystemPrompt 注入 5 类报告 Skill 矩阵（Task 4.3 软约束）', () => {
  test('REPORT_SKILL_MATRIX 常量应被导出且含 5 类报告标题', () => {
    expect(REPORT_SKILL_MATRIX).toBeDefined()
    expect(REPORT_SKILL_MATRIX).toContain('5 类报告')
    expect(REPORT_SKILL_MATRIX).toContain('必调 Skill 矩阵')
  })

  test('buildSystemPrompt 应注入 5 类报告 → 必调 Skill 矩阵（关键内容）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['calculate_mix_design', 'performance_prediction'],
      agentMdRules: ''
    })
    expect(prompt).toContain('5 类报告')
    expect(prompt).toContain('配合比设计报告')
    expect(prompt).toContain('calculate_mix_design')
    expect(prompt).toContain('workspace_search')
  })

  test('buildSystemPrompt 应覆盖全部 5 类报告场景', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('配合比设计报告')
    expect(prompt).toContain('多方案对比')
    expect(prompt).toContain('报价单')
    expect(prompt).toContain('原材料检测报告')
    expect(prompt).toContain('PDF 知识源报告')
  })

  test('buildSystemPrompt 应包含全部关键 Skill 名（calculate_mix_design / cost_optimization / prepare_quote_draft / compliance_check / performance_prediction）', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('calculate_mix_design')
    expect(prompt).toContain('cost_optimization')
    expect(prompt).toContain('prepare_quote_draft')
    expect(prompt).toContain('compliance_check')
    expect(prompt).toContain('performance_prediction')
  })

  test('matrix 应出现在 agentMdRules 之后、回答风格之前（位置正确）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      agentMdRules: '我的规则占位'
    })
    const idxRules = prompt.indexOf('我的规则占位')
    const idxMatrix = prompt.indexOf('5 类报告')
    const idxStyle = prompt.indexOf('回答风格')
    expect(idxRules).toBeGreaterThan(-1)
    expect(idxMatrix).toBeGreaterThan(idxRules)
    expect(idxStyle).toBeGreaterThan(idxMatrix)
  })
})
