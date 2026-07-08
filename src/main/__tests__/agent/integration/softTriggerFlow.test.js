const fs = require('fs')
const path = require('path')
const os = require('os')
const SkillRegistry = require('../../../agent/SkillRegistry')
const MDParser = require('../../../agent/MDParser')
const SubFileResolver = require('../../../agent/SubFileResolver')
const SoftSkillInjector = require('../../../agent/SoftSkillInjector')
const { buildSystemPrompt } = require('../../../agent/systemPromptBuilder')

describe('软触发 Skill 集成流程', () => {
  let tmpDir, registry, injector, resolver

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-'))
    fs.mkdirSync(path.join(tmpDir, '.concrete-mixdesign', 'skills', 'brainstorm'), { recursive: true })

    // 创建 soft skill
    fs.writeFileSync(path.join(tmpDir, '.concrete-mixdesign', 'skills', 'brainstorm.md'), `---
name: brainstorm
description: 老板提任何混凝土创新需求时 MUST use，引导 4 阶段达成方案。
category: innovation
trigger_mode: soft
---

# Concrete Innovation Brainstorm

[HARD-GATE] 未完成第 4 阶段不允许输出方案文档 [/HARD-GATE]

[reference.md](reference.md) 给了详细方法论。

## Checklist
1. 调 todo_manage 建 4 个任务
2. 阶段 1：调 list_available_materials
3. 阶段 2：提 3-5 方向 + 调 ask_user
4. 阶段 4：写 spec
`)

    // 创建子文件
    fs.writeFileSync(path.join(tmpDir, '.concrete-mixdesign', 'skills', 'brainstorm', 'reference.md'), '# ref details')

    registry = new SkillRegistry({ userDir: path.join(tmpDir, '.concrete-mixdesign', 'skills') })
    await registry._loadFromDir(path.join(tmpDir, '.concrete-mixdesign', 'skills'), { builtin: false })
    resolver = new SubFileResolver()
    injector = new SoftSkillInjector({
      skillRegistry: registry,
      mdInstructionBuilder: resolver,
      subFileResolver: resolver,
      baseDir: path.join(tmpDir, '.concrete-mixdesign', 'skills')
    })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('完整流程：发现 → 触发 → Layer 1+2 注入 → 退激活 → 清理', async () => {
    // 1. soft skill 被加载
    expect(registry.listSoftSkills()).toHaveLength(1)
    expect(registry.listSoftSkills()[0].name).toBe('brainstorm')

    // 2. 用户消息匹配 description
    const r1 = injector.tryActivate('sess1', '我要做低碳混凝土创新')
    expect(r1.activated).toBe(true)
    expect(r1.skillName).toBe('brainstorm')

    // 3. buildInjectionSection 返回完整 section（含 Layer 1+2+3）
    const section = await injector.buildInjectionSection('sess1')
    expect(section).toContain('老板提任何混凝土创新需求时 MUST use')  // Layer 1 完整 description
    expect(section).toContain('🔓 ACTIVE SKILL')
    expect(section).toContain('HARD-GATE')  // Layer 2 body
    expect(section).toContain('ref details')  // Layer 3 子文件已加载

    // 4. systemPromptBuilder 正确接收 softSkillSection
    const prompt = buildSystemPrompt({
      userRulesMarkdown: 'rules',
      softSkillSection: section.split('\n## 🔓')[0]  // 只取 Layer 1 部分
    })
    expect(prompt).toContain('方法论 Skill')
    expect(prompt).toContain('MUST use')  // 不截断

    // 5. 退激活
    const r2 = injector.tryActivate('sess1', '算了，退出')
    expect(r2.activated).toBe(false)
    expect(r2.reason).toBe('deactivated')

    // 6. 退激活后 section 不再含 Layer 2
    const section2 = await injector.buildInjectionSection('sess1')
    expect(section2).not.toContain('HARD-GATE')

    // 7. 清理
    injector.cleanup('sess1')
    const section3 = await injector.buildInjectionSection('sess1')
    expect(section3).toBe('')
  })

  test('soft skill 不进 getToolSchemas（避免双轨）', () => {
    const schemas = registry.getToolSchemas()
    const names = schemas.map(s => s.function.name)
    expect(names).not.toContain('brainstorm')
  })

  test('function call tool 仍进 getToolSchemas', async () => {
    // 临时添加一个 tool
    fs.writeFileSync(path.join(tmpDir, '.concrete-mixdesign', 'skills', 'tool1.md'), `---
name: tool1
description: 普通工具
trigger_mode: function
---
# body`)

    await registry._loadFromDir(path.join(tmpDir, '.concrete-mixdesign', 'skills'), { builtin: false })
    const names = registry.getToolSchemas().map(s => s.function.name)
    expect(names).toContain('tool1')
  })
})
