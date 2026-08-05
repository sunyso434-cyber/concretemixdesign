/**
 * SkillRegistry._normalizeCategory 单测
 *
 * 阶段 2 任务 2.6：category 归并（v5 spec 3.5.4）
 * - 18 种真实 category + concrete_type 新值，统一归并到 9 大类
 * - 同时兼容旧值 'blueprint'（过渡期）与 concrete_type 值（新值）
 *
 * 归并规则：
 * - blueprint → flow（旧值过渡期）；workflow → flow（concrete_type 通用流程值）
 * - mix_design/sales_quote/ordinary 等 concrete_type 业务值 → tool
 * - agent/system/settings → agent；core/optimization/analysis → tool
 * - save/update/delete/manage/recording/training → manage
 * - innovation → method
 * - workspace/custom/vision/query 身份保留
 */

const SkillRegistry = require('../SkillRegistry')

describe('SkillRegistry._normalizeCategory', () => {
  let registry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  test("'blueprint'（旧值，过渡期）→ 'flow'", () => {
    expect(registry._normalizeCategory('blueprint')).toBe('flow')
  })

  test("concrete_type 通用流程值 'workflow' → 'flow'", () => {
    expect(registry._normalizeCategory('workflow')).toBe('flow')
  })

  test("concrete_type 业务值 'mix_design' → 'tool'", () => {
    expect(registry._normalizeCategory('mix_design')).toBe('tool')
  })

  test("concrete_type 业务值 'sales_quote' → 'tool'", () => {
    expect(registry._normalizeCategory('sales_quote')).toBe('tool')
  })

  test("未显式列出的 concrete_type 业务值（如 'ordinary'/'self_compacting'）→ 'tool'", () => {
    expect(registry._normalizeCategory('ordinary')).toBe('tool')
    expect(registry._normalizeCategory('self_compacting')).toBe('tool')
  })

  test("'innovation' → 'method'", () => {
    expect(registry._normalizeCategory('innovation')).toBe('method')
  })

  test('agent/system/settings → agent', () => {
    for (const v of ['agent', 'system', 'settings']) {
      expect(registry._normalizeCategory(v)).toBe('agent')
    }
  })

  test('core/optimization/analysis → tool', () => {
    for (const v of ['core', 'optimization', 'analysis']) {
      expect(registry._normalizeCategory(v)).toBe('tool')
    }
  })

  test('save/update/delete/manage/recording/training → manage', () => {
    for (const v of ['save', 'update', 'delete', 'manage', 'recording', 'training']) {
      expect(registry._normalizeCategory(v)).toBe('manage')
    }
  })

  test('workspace/custom/vision/query 身份保留', () => {
    for (const v of ['workspace', 'custom', 'vision', 'query']) {
      expect(registry._normalizeCategory(v)).toBe(v)
    }
  })

  test('undefined/null 透传（由调用方兜底）', () => {
    expect(registry._normalizeCategory(undefined)).toBeUndefined()
    expect(registry._normalizeCategory(null)).toBeNull()
  })

  test('getSkillMeta 输出归一化后的 category（LLM/system 所见即归一化值）', () => {
    registry.register({
      name: 'bp_skill',
      description: '蓝图技能',
      category: 'blueprint',
      execute: () => {}
    })
    registry.register({
      name: 'mix_skill',
      description: '配合比设计',
      category: 'ordinary',
      execute: () => {}
    })
    registry.register({
      name: 'inv_skill',
      description: '方法论',
      category: 'innovation',
      execute: () => {}
    })
    expect(registry.getSkillMeta('bp_skill').category).toBe('flow')
    expect(registry.getSkillMeta('mix_skill').category).toBe('tool')
    expect(registry.getSkillMeta('inv_skill').category).toBe('method')
  })

  test('listSoftSkills 输出归一化后的 category（soft skill 注入 system-prompt）', () => {
    registry.register({
      name: 'soft_innovation',
      description: '方法论 soft skill',
      category: 'innovation',
      _triggerMode: 'soft',
      execute: () => {}
    })
    const list = registry.listSoftSkills()
    expect(list).toHaveLength(1)
    expect(list[0].category).toBe('method')
  })
})
