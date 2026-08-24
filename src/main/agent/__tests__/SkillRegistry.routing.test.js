/**
 * SkillRegistry catalog 路由扩展单元测试（技能目录式路由 · T3）
 *
 * 覆盖：isResident（名单/前缀/元工具/非法输入）、
 * getRoutingToolSchemas（常驻∪已加载、soft 过滤、顺序去重）、
 * getSkillSchema（存在/不存在/soft 返回 null）。
 */

const SkillRegistry = require('../SkillRegistry')

function makeSkill(name, description, extra = {}) {
  return { name, description, execute: () => {}, ...extra }
}

function schemaNames(schemas) {
  return schemas.map(s => s.function.name)
}

describe('SkillRegistry.isResident', () => {
  test('RESIDENT_SKILL_NAMES 名单命中', () => {
    const registry = new SkillRegistry()
    expect(registry.isResident('ask_user')).toBe(true)
    expect(registry.isResident('recall_session')).toBe(true)
  })

  test('workspace_ 前缀伪 skill 命中（无需真实注册）', () => {
    const registry = new SkillRegistry()
    expect(registry.isResident('workspace_search')).toBe(true)
    expect(registry.isResident('workspace_readPage')).toBe(true)
    expect(registry.isResident('workspaceX_foo')).toBe(false)
  })

  test('use_skill 元工具命中', () => {
    const registry = new SkillRegistry()
    expect(registry.isResident('use_skill')).toBe(true)
  })

  test('业务技能与非法输入不命中', () => {
    const registry = new SkillRegistry()
    expect(registry.isResident('calculate_mix_design')).toBe(false)
    expect(registry.isResident('')).toBe(false)
    expect(registry.isResident(null)).toBe(false)
    expect(registry.isResident(123)).toBe(false)
  })
})

describe('SkillRegistry.getRoutingToolSchemas', () => {
  let registry

  beforeEach(() => {
    registry = new SkillRegistry()
    // 常驻基础件 + 元工具
    for (const name of ['ask_user', 'todo_manage']) {
      registry.register(makeSkill(name, `${name} 常驻`))
    }
    // workspace 伪 skill 模拟
    registry.register(makeSkill('workspace_search', '搜索 wiki 页'))
    // 业务技能：默认不在常驻集
    registry.register(makeSkill('calculate_mix_design', '计算配合比'))
    registry.register(makeSkill('manage_materials', '管理原材料台账'))
  })

  test('无已加载时只返回常驻集，业务技能不带 schema', () => {
    const names = schemaNames(registry.getRoutingToolSchemas([]))
    expect(names).toEqual(['ask_user', 'todo_manage', 'workspace_search'])
    expect(names).not.toContain('calculate_mix_design')
  })

  test('loadedNames 命中的业务技能进入集合', () => {
    const names = schemaNames(registry.getRoutingToolSchemas(['manage_materials']))
    expect(names).toContain('manage_materials')
    expect(names).toContain('ask_user')
  })

  test('loadedNames 中不存在的名字被静默过滤，不崩溃', () => {
    const names = schemaNames(registry.getRoutingToolSchemas(['ghost_skill', 'manage_materials']))
    expect(names).toContain('manage_materials')
    expect(names).not.toContain('ghost_skill')
  })

  test('loadedNames 中 soft trigger 技能不放行', () => {
    registry.register(makeSkill('soft_guide', '方法论说明', {
      _isMDSkill: true,
      _triggerMode: 'soft'
    }))
    const names = schemaNames(registry.getRoutingToolSchemas(['soft_guide']))
    expect(names).not.toContain('soft_guide')
  })

  test('重复名字去重（常驻与 loadedNames 重叠只出现一次）', () => {
    const schemas = registry.getRoutingToolSchemas(['ask_user', 'manage_materials'])
    const names = schemaNames(schemas)
    expect(names.filter(n => n === 'ask_user')).toHaveLength(1)
  })

  test('Set 入参与 Array 等价；undefined 等价空集', () => {
    const viaSet = schemaNames(registry.getRoutingToolSchemas(new Set(['manage_materials'])))
    const viaArray = schemaNames(registry.getRoutingToolSchemas(['manage_materials']))
    const viaNone = schemaNames(registry.getRoutingToolSchemas())
    expect(viaSet).toEqual(viaArray)
    expect(viaNone).not.toContain('manage_materials')
  })
})

describe('SkillRegistry.getSkillSchema', () => {
  let registry

  beforeEach(() => {
    registry = new SkillRegistry()
    registry.register(makeSkill('save_sales_quote', '保存报价单', {
      parameters: { projectName: { type: 'string', required: true } }
    }))
  })

  test('存在：返回与 getToolSchemas 相同形状的 JSON Schema', () => {
    const schema = registry.getSkillSchema('save_sales_quote')
    expect(schema.type).toBe('function')
    expect(schema.function.name).toBe('save_sales_quote')
    expect(schema.function.parameters.properties.projectName).toBeDefined()
  })

  test('不存在返回 null；soft 技能返回 null（双轨管理）', () => {
    expect(registry.getSkillSchema('nope')).toBeNull()
    registry.register(makeSkill('soft_x', 'x 方法论', { _isMDSkill: true, _triggerMode: 'soft' }))
    expect(registry.getSkillSchema('soft_x')).toBeNull()
  })
})
