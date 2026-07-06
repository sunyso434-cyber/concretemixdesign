const { buildSystemPrompt, REPORT_SKILL_MATRIX } = require('../systemPromptBuilder')

describe('systemPromptBuilder v2 基础', () => {
  test('应输出包含角色定义的字符串', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['skill_a', 'skill_b'],
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('混凝土配合比')
  })

  test('应注入技能列表', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['query_material', 'calculate_ratio'],
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('query_material')
    expect(prompt).toContain('calculate_ratio')
  })

  test('应注入记忆上下文（如有）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '用户偏好 42.5 水泥',
      skillNames: [],
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('用户偏好 42.5 水泥')
  })

  test('空 skillNames 不应崩溃', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      userRulesMarkdown: ''
    })
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })
})

// Task 8 v2：userRulesMarkdown 整段注入 + HTML 注释包裹
describe('buildSystemPrompt v2 - userRulesMarkdown（Task 8）', () => {
  test('userRulesMarkdown 整段注入并用 HTML 注释包裹', () => {
    const result = buildSystemPrompt({
      userRulesMarkdown: '## 业务规则\n- 老板偏好 C30',
      skillNames: []
    })
    expect(result).toContain('<!-- 老板自定义规则开始 -->')
    expect(result).toContain('## 业务规则')
    expect(result).toContain('- 老板偏好 C30')
    expect(result).toContain('<!-- 老板自定义规则结束 -->')
    // 开始/结束注释之间的内容顺序：开始 → 内容 → 结束
    const startIdx = result.indexOf('<!-- 老板自定义规则开始 -->')
    const contentIdx = result.indexOf('## 业务规则')
    const endIdx = result.indexOf('<!-- 老板自定义规则结束 -->')
    expect(startIdx).toBeGreaterThan(-1)
    expect(contentIdx).toBeGreaterThan(startIdx)
    expect(endIdx).toBeGreaterThan(contentIdx)
  })

  test('userRulesMarkdown 为空时显示"未配置"', () => {
    const result = buildSystemPrompt({ skillNames: [] })
    expect(result).toContain('（未配置，使用系统默认）')
  })

  test('无 agentMdRules / preferenceSummary 旧参数（验证删除）', () => {
    // 旧参数即使传了也应被忽略
    const result = buildSystemPrompt({
      agentMdRules: '## 旧规则',
      preferenceSummary: '- 老摘要',
      skillNames: []
    })
    // 旧参数不应被注入
    expect(result).not.toContain('## 旧规则')
    expect(result).not.toContain('老摘要')
  })

  test('v2 已删除 SIZE_LIMIT 截断警告', () => {
    // 旧逻辑：超过 4KB 追加 "（agent.md 过大，已截断...）"
    const big = 'x'.repeat(5000)
    const result = buildSystemPrompt({
      userRulesMarkdown: big,
      skillNames: []
    })
    expect(result).not.toContain('已截断')
    expect(result).toContain('x')
  })

  test('v2 已删除 tokenWarn 警告', () => {
    // 旧逻辑：memoryContext + rulesText 总长 >4000 追加 "⚠️ system prompt 接近 2000 token 上限"
    const bigMemory = 'y'.repeat(3000)
    const bigRules = 'z'.repeat(1500)
    const result = buildSystemPrompt({
      memoryContext: bigMemory,
      userRulesMarkdown: bigRules,
      skillNames: []
    })
    expect(result).not.toContain('2000 token 上限')
    expect(result).not.toContain('请精简 agent.md')
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
      userRulesMarkdown: ''
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
    // v1 改造：原 "wiki 摘要更精炼" 已替换为 search 摘要增强 + 路由建议
    expect(prompt).toContain('summary/keyPoints')
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
      userRulesMarkdown: ''
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

  test('matrix 应出现在 userRulesMarkdown 之后、回答风格之前（位置正确）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      userRulesMarkdown: '我的规则占位'
    })
    const idxRules = prompt.indexOf('我的规则占位')
    const idxMatrix = prompt.indexOf('5 类报告')
    const idxStyle = prompt.indexOf('回答风格')
    expect(idxRules).toBeGreaterThan(-1)
    expect(idxMatrix).toBeGreaterThan(idxRules)
    expect(idxStyle).toBeGreaterThan(idxMatrix)
  })
})

// skillInfos：按 category 自动分组生成技能列表（避免硬编码漏技能）
describe('buildSystemPrompt 注入 skillInfos 按 category 分组', () => {
  const sampleInfos = [
    { name: 'calculate_mix_design', category: 'core', description: '根据给定参数计算混凝土配合比。返回各材料用量、水胶比、砂率、容重、成本等结果。' },
    { name: 'cost_optimization', category: 'core', description: '对给定材料和约束条件执行网格搜索，找出成本最低的混凝土配合比方案。' },
    { name: 'list_mix_designs', category: 'query', description: '列出配合比方案（正式/草稿）。支持按状态/强度/关键词过滤。' },
    { name: 'ask_user', category: 'meta', description: '向用户提问/澄清，前端弹窗收集回答后回灌。' }
  ]

  test('应按 category 自动分组生成技能段', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      skillInfos: sampleInfos,
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('【core】')
    expect(prompt).toContain('【query】')
    expect(prompt).toContain('【meta】')
  })

  test('每个技能应显示 name + 截断后的 description', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      skillInfos: sampleInfos,
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('calculate_mix_design：')
    expect(prompt).toContain('list_mix_designs：')
    // description 截断到 30 字
    expect(prompt).toContain('根据给定参数计算混凝土配合比')
    expect(prompt).not.toContain('根据给定参数计算混凝土配合比。返回各材料用量、水胶比、砂率、容重、成本等结果')
  })

  test('应显示技能总数', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      skillInfos: sampleInfos,
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('共 4 个')
  })

  test('应包含反模式提示（禁止硬编技能名）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      skillInfos: sampleInfos,
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('不要硬编')
  })

  test('category 缺失时应降级到 general', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      skillInfos: [{ name: 'unknown_skill', category: undefined, description: '测试' }],
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('【general】')
  })

  test('skillInfos 缺失时应降级到 skillNames（只列名字）', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['fallback_skill'],
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('- fallback_skill')
    expect(prompt).not.toContain('【core】')
  })

  test('skillInfos 为空数组时应降级到 skillNames', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['fallback_skill'],
      skillInfos: [],
      userRulesMarkdown: ''
    })
    expect(prompt).toContain('- fallback_skill')
  })
})