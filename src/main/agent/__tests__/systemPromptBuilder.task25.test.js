const { buildSystemPrompt } = require('../systemPromptBuilder')

// Task 2.5：workspace 工具数动态化（不再硬编码 8）
describe('Task 2.5：workspace 工具数动态化', () => {
  test('从 skillInfos 统计 workspace_ 前缀工具数（非 workspace 技能不计入）', () => {
    const infos = []
    for (let i = 1; i <= 14; i++) {
      infos.push({ name: `workspace_工具${i}`, category: 'workspace', description: `第 ${i} 个工具说明。` })
    }
    // 非 workspace 技能不应计入工具数
    infos.push({ name: 'calculate_mix_design', category: 'core', description: '计算配合比。' })
    const prompt = buildSystemPrompt({ skillInfos: infos })
    expect(prompt).toContain('可用 workspace 工具（共 14 个）')
    expect(prompt).not.toContain('共 8 个')
  })

  test('skillInfos 缺失时从 skillNames 统计 workspace 工具数', () => {
    const prompt = buildSystemPrompt({
      skillNames: ['workspace_search', 'workspace_grep', 'workspace_readPage', 'calculate_mix_design']
    })
    expect(prompt).toContain('可用 workspace 工具（共 3 个）')
    expect(prompt).not.toContain('共 8 个')
  })

  test('未传技能列表时回退到正文罗列的工具数（自洽，非 0 非 8）', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('可用 workspace 工具（共 10 个）')
  })
})

// Task 2.5：description 截断到完整句子（不硬切句中）
describe('Task 2.5：description 截断到完整句子', () => {
  test('窗口内有句号时截断到最后一个句号（不切句中）', () => {
    const prompt = buildSystemPrompt({
      skillInfos: [{
        name: 'skill_a',
        category: 'core',
        description: '第一句说明功能。第二句补充细节，这里很长超过三十个字符限制导致必须截断。'
      }]
    })
    expect(prompt).toContain('skill_a：第一句说明功能。')
    expect(prompt).not.toContain('第二句')
  })

  test('窗口内无句号时延伸到下一个句号（结果以标点结尾）', () => {
    const prompt = buildSystemPrompt({
      skillInfos: [{
        name: 'skill_b',
        category: 'core',
        description: '这个描述的前三十个字符内部完全没有句子结束标点一直到更后面才有一个句号。'
      }]
    })
    expect(prompt).toContain('skill_b：这个描述的前三十个字符内部完全没有句子结束标点一直到更后面才有一个句号。')
  })

  test('窗口与扩展区都无标点时退化为空白截断（不切英文单词）', () => {
    const prompt = buildSystemPrompt({
      skillInfos: [{
        name: 'skill_d',
        category: 'core',
        description: 'xxxxxxxxxx yyyyyyyyyyyyyyyyyyyyzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
      }]
    })
    expect(prompt).toContain('skill_d：xxxxxxxxxx')
    expect(prompt).not.toContain('skill_d：xxxxxxxxxx ')
  })

  test('无标点且无空格时硬切到 30 字（不崩溃）', () => {
    const prompt = buildSystemPrompt({
      skillInfos: [{
        name: 'skill_f',
        category: 'core',
        description: 'x'.repeat(40) + 'y'.repeat(40)
      }]
    })
    expect(prompt).toContain(`skill_f：${'x'.repeat(30)}`)
  })

  test('短 description 原样保留', () => {
    const prompt = buildSystemPrompt({
      skillInfos: [{ name: 'skill_c', category: 'core', description: '很短。' }]
    })
    expect(prompt).toContain('skill_c：很短。')
  })

  test('description 缺失时输出空说明（不崩溃）', () => {
    const prompt = buildSystemPrompt({
      skillInfos: [{ name: 'skill_e', category: 'core' }] // 无 description 字段
    })
    expect(prompt).toContain('skill_e：')
  })
})

// 补充：覆盖既有路径中未触达的分支（保持覆盖率稳定超过 90% 阈值）
describe('Task 2.5：补充分支覆盖', () => {
  test('buildSystemPrompt 无参数调用走默认值（不崩溃）', () => {
    const prompt = buildSystemPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('混凝土配合比')
  })

  test('L3 仅 currentSession（keyDecisions/recalled 缺失）', () => {
    const prompt = buildSystemPrompt({ l3Summary: { currentSession: '仅当前会话' } })
    expect(prompt).toContain('仅当前会话')
    expect(prompt).not.toContain('老板关键决策')
  })

  test('L3 仅 recalled（currentSession 缺失）', () => {
    const prompt = buildSystemPrompt({ l3Summary: { recalled: [{ sessionId: 's', summary: '上次记忆' }] } })
    expect(prompt).toContain('上次记忆')
  })

  test('L3 空数组字段（keyDecisions/recalled 无内容）不注入', () => {
    const prompt = buildSystemPrompt({ l3Summary: { keyDecisions: [], recalled: [] } })
    expect(prompt).not.toContain('# 核心记忆摘要')
  })

  test('L3 空对象不注入核心记忆段', () => {
    const prompt = buildSystemPrompt({ l3Summary: {} })
    expect(prompt).not.toContain('# 核心记忆摘要')
  })
})
