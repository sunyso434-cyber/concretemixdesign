const { buildSystemPrompt } = require('../../agent/systemPromptBuilder')

describe('systemPromptBuilder - softSkillSection 参数', () => {
  test('softSkillSection 空时不出现"方法论"段', () => {
    const result = buildSystemPrompt({ userRulesMarkdown: 'rules' })
    expect(result).not.toContain('方法论 Skill')
  })

  test('softSkillSection 提供时完整 description 进 prompt', () => {
    const longDesc = '老板提任何混凝土创新需求时 MUST use。本技能以 4 阶段引导达成方案后输出 spec 文档，不允许跳阶段。'
    const result = buildSystemPrompt({
      userRulesMarkdown: 'rules',
      softSkillSection: `- concrete_innovation_brainstorm: ${longDesc}`
    })
    expect(result).toContain('方法论 Skill')
    expect(result).toContain(longDesc)  // 完整 description，不截
    expect(result).toContain('concrete_innovation_brainstorm')
  })

  test('softSkillSection 在 skills section 之后、用户记忆之前', () => {
    const result = buildSystemPrompt({
      skillInfos: [{ name: 'tool1', description: '工具1', category: 'general' }],
      softSkillSection: '- soft1: 软工具1',
      userRulesMarkdown: 'rules'
    })
    const idxSoft = result.indexOf('方法论 Skill')
    const idxSkill = result.indexOf('当前可用技能')
    expect(idxSoft).toBeGreaterThan(idxSkill)
  })
})
