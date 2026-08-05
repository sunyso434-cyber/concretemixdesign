/**
 * SkillRegistry.getRelevantToolSchemas 单元测试
 *
 * 阶段 2 任务 2.4：按需加载技能路由
 * - 常驻 skill（ask_user/todo_manage/web_search/web_fetch/recall_session）始终返回
 * - todo 指定（planSteps.suggestedSkill / skill）命中
 * - 关键词匹配（recentMessages + planSteps.content 抽取关键词，命中 name/description）
 * - 去重（同一 skill 同时被关键词和 todo 命中只出现一次）
 * - 缺失常驻 skill 容错（不存在不崩溃）
 */

const SkillRegistry = require('../SkillRegistry')

// 常驻 skill 定义（与实现内清单一致，便于测试可控）
const RESIDENT_DEFS = [
  { name: 'ask_user', description: '向用户提问，获取澄清信息' },
  { name: 'todo_manage', description: '管理任务列表，创建更新完成步骤' },
  { name: 'web_search', description: '联网搜索获取最新资料' },
  { name: 'web_fetch', description: '抓取指定网页正文内容' },
  { name: 'recall_session', description: '回顾历史会话记录' }
]

function makeSkill(name, description, extra = {}) {
  return { name, description, execute: () => {}, ...extra }
}

function registerResident(registry, names = RESIDENT_DEFS.map(d => d.name)) {
  for (const def of RESIDENT_DEFS) {
    if (names.includes(def.name)) registry.register(makeSkill(def.name, def.description))
  }
  return registry
}

function schemaNames(schemas) {
  return schemas.map(s => s.function.name)
}

describe('SkillRegistry.getRelevantToolSchemas', () => {
  let registry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  test('常驻：含 5 个常驻 skill 时，无关键词无 todo 也全部返回', () => {
    registerResident(registry)
    const schemas = registry.getRelevantToolSchemas('s1', ['随便'], [])
    const names = schemaNames(schemas)
    expect(names).toHaveLength(5)
    for (const def of RESIDENT_DEFS) {
      expect(names).toContain(def.name)
    }
  })

  test('常驻：schema 复用 getToolSchemas 的 JSON-Schema 形状', () => {
    registerResident(registry)
    registry.register(makeSkill('param_skill', '带参数的技能', {
      parameters: { input: { type: 'string', description: '输入', required: true } }
    }))
    const planSteps = [{ content: '执行带参数技能', suggestedSkill: 'param_skill' }]
    const schema = registry.getRelevantToolSchemas('s1', [], planSteps)
      .find(s => s.function.name === 'param_skill')
    expect(schema).toMatchObject({
      type: 'function',
      function: {
        name: 'param_skill',
        description: '带参数的技能',
        parameters: { type: 'object' }
      }
    })
    expect(schema.function.parameters.properties.input).toBeDefined()
    expect(schema.function.parameters.required).toContain('input')
  })

  test('关键词：recentMessages 含"水泥强度"命中描述含"强度"或名字含"水泥"的 skill', () => {
    registerResident(registry)
    registry.register(makeSkill('cement_strength', '查询水泥强度等级，判断混凝土质量'))
    registry.register(makeSkill('shuini_data', '管理水泥批次台账数据'))
    registry.register(makeSkill('cost_optimization', '配合比成本优化与多目标分析'))

    const schemas = registry.getRelevantToolSchemas('s1', ['帮我查一下水泥强度'], [])
    const names = schemaNames(schemas)
    expect(names).toContain('cement_strength')
    expect(names).toContain('shuini_data')
    expect(names).not.toContain('cost_optimization')
  })

  test('todo 指定：planSteps.suggestedSkill 命中的 skill 被返回', () => {
    registerResident(registry)
    registry.register(makeSkill('save_mix_design', '保存配合比设计方案'))
    const planSteps = [{ content: '设计 C30 配合比并保存', suggestedSkill: 'save_mix_design' }]
    const schemas = registry.getRelevantToolSchemas('s1', [], planSteps)
    expect(schemaNames(schemas)).toContain('save_mix_design')
  })

  test('todo 指定：planSteps.skill 字段同样支持', () => {
    registerResident(registry)
    registry.register(makeSkill('query_trial_tests', '查询试配试验记录'))
    const planSteps = [{ content: '查询试配结果', skill: 'query_trial_tests' }]
    const schemas = registry.getRelevantToolSchemas('s1', [], planSteps)
    expect(schemaNames(schemas)).toContain('query_trial_tests')
  })

  test('去重：同一 skill 被关键词和 todo 同时命中只出现一次', () => {
    registerResident(registry)
    registry.register(makeSkill('query_trial_tests', '查询试配试验记录'))
    const planSteps = [{ content: '查询试配结果', suggestedSkill: 'query_trial_tests' }]
    const schemas = registry.getRelevantToolSchemas('s1', ['查一下试配记录'], planSteps)
    const names = schemaNames(schemas)
    expect(names.filter(n => n === 'query_trial_tests')).toHaveLength(1)
  })

  test('缺失常驻 skill 容错：缺一个常驻 skill 不崩溃，只返回存在的', () => {
    registerResident(registry, RESIDENT_DEFS.map(d => d.name).filter(n => n !== 'recall_session'))
    const schemas = registry.getRelevantToolSchemas('s1', [], [])
    const names = schemaNames(schemas)
    expect(names).not.toContain('recall_session')
    expect(names).toHaveLength(4)
  })

  test('soft 触发 skill 即使关键词命中也不进 tools', () => {
    registerResident(registry)
    registry.register(makeSkill('soft_guide', '水泥强度换算参考说明', {
      _isMDSkill: true,
      _triggerMode: 'soft'
    }))
    const schemas = registry.getRelevantToolSchemas('s1', ['水泥强度'], [])
    expect(schemaNames(schemas)).not.toContain('soft_guide')
  })
})
