/**
 * SkillRegistry 公开方法单测
 *
 * C3 任务：验证新增的 getUserSkillsMap / unregister / reset 三个公开方法。
 *
 * 关键点：
 * - register 会自动调用 _validateSkill，所以测试 skill 必须带 name + description + execute
 * - getSkill 不存在时返回 null（C 已有行为，不改）
 */

const SkillRegistry = require('../SkillRegistry')

describe('SkillRegistry 公开方法', () => {
  let registry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  test('getUserSkillsMap 应返回 Map', () => {
    const map = registry.getUserSkillsMap()
    expect(map).toBeInstanceOf(Map)
  })

  test('register / unregister 应配对工作', () => {
    const skill = {
      name: 'test',
      description: 'test skill',
      execute: () => {}
    }
    registry.register(skill)
    expect(registry.getSkill('test')).toBe(skill)
    registry.unregister('test')
    expect(registry.getSkill('test')).toBeNull()
  })

  test('reset 应清空所有技能', () => {
    registry.register({ name: 'a', description: 'a skill', execute: () => {} })
    registry.register({ name: 'b', description: 'b skill', execute: () => {} })
    registry.reset()
    expect(registry.getSkill('a')).toBeNull()
    expect(registry.getSkill('b')).toBeNull()
  })
})
