const SkillRegistry = require('../../agent/SkillRegistry')
const path = require('path')
const fs = require('fs')
const os = require('os')

describe('SkillRegistry - triggerMode 字段', () => {
  let tmpDir
  let registry

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'))
    registry = new SkillRegistry({ userDir: tmpDir })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('soft skill 注册时被识别为 trigger_mode=soft', () => {
    fs.writeFileSync(path.join(tmpDir, 'brainstorm.md'), `---
name: brainstorm
description: 创新脑暴
trigger_mode: soft
---

# body content
`)

    return registry._loadFromDir(tmpDir, { builtin: false }).then(() => {
      const skill = registry.getSkill('brainstorm')
      expect(skill._triggerMode).toBe('soft')
    })
  })

  test('老文件无 trigger_mode 字段默认 function', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    fs.writeFileSync(path.join(tmpDir, 'old_skill.md'), `---
name: old_skill
description: 老的
---

# body
`)

    return registry._loadFromDir(tmpDir, { builtin: false }).then(() => {
      const skill = registry.getSkill('old_skill')
      expect(skill._triggerMode).toBe('function')
      // absent 走 silent default，不应触发 warn
      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })
  })

  test('非法 trigger_mode 值降级到 function', () => {
    fs.writeFileSync(path.join(tmpDir, 'weird.md'), `---
name: weird
description: 怪
trigger_mode: invalid_mode
---

# body
`)

    return registry._loadFromDir(tmpDir, { builtin: false }).then(() => {
      const skill = registry.getSkill('weird')
      expect(skill._triggerMode).toBe('function')
    })
  })

  test('listSoftSkills() 只返回 soft skill', async () => {
    fs.writeFileSync(path.join(tmpDir, 'soft1.md'), frontmatter({ trigger_mode: 'soft', name: 'soft1' }))
    fs.writeFileSync(path.join(tmpDir, 'tool1.md'), frontmatter({ trigger_mode: 'function', name: 'tool1' }))

    await registry._loadFromDir(tmpDir, { builtin: false })
    const soft = registry.listSoftSkills()
    expect(soft).toHaveLength(1)
    expect(soft[0].name).toBe('soft1')
  })

  test('isSoftTrigger() 对 soft skill 返回 true，function skill 返回 false，未知 name 返回 false', async () => {
    fs.writeFileSync(path.join(tmpDir, 'soft_skill.md'), frontmatter({ trigger_mode: 'soft', name: 'soft_skill' }))
    fs.writeFileSync(path.join(tmpDir, 'func_skill.md'), frontmatter({ trigger_mode: 'function', name: 'func_skill' }))

    await registry._loadFromDir(tmpDir, { builtin: false })

    expect(registry.isSoftTrigger('soft_skill')).toBe(true)
    expect(registry.isSoftTrigger('func_skill')).toBe(false)
    expect(registry.isSoftTrigger('does_not_exist')).toBe(false)
  })

  test('非法 trigger_mode 降级为 function 且触发 warn', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    fs.writeFileSync(path.join(tmpDir, 'weird.md'), `---
name: weird
description: 怪
trigger_mode: invalid_mode
---

# body
`)

    await registry._loadFromDir(tmpDir, { builtin: false })

    const skill = registry.getSkill('weird')
    expect(skill._triggerMode).toBe('function')
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(warnMsg).toMatch(/trigger_mode|invalid/)

    warnSpy.mockRestore()
  })
})

function frontmatter({ name, trigger_mode }) {
  return `---
name: ${name}
description: desc
trigger_mode: ${trigger_mode}
---
# body`
}
