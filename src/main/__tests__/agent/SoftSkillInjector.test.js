const SoftSkillInjector = require('../../agent/SoftSkillInjector')

describe('SoftSkillInjector', () => {
  let injector, mockRegistry, mockResolver, mockSubFileResolver

  beforeEach(() => {
    mockRegistry = {
      listSoftSkills: jest.fn(() => []),
      getSkill: jest.fn(),
      _skills: new Map()
    }
    mockResolver = {
      parseSubFileRefs: jest.fn(() => [])
    }
    mockSubFileResolver = {
      loadSubFile: jest.fn(async () => ({ success: false, error: 'not found' }))
    }

    injector = new SoftSkillInjector({
      skillRegistry: mockRegistry,
      mdInstructionBuilder: mockResolver,
      subFileResolver: mockSubFileResolver,
      baseDir: '/tmp/test-skills'
    })
  })

  describe('tryActivate', () => {
    test('首次调用 + 描述匹配 → 激活', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '老板提任何创新需求时 MUST use。引导 4 阶段达成方案...' }
      ])
      const result = injector.tryActivate('sess1', '我想做个低碳混凝土方案')
      expect(result.activated).toBe(true)
      expect(result.skillName).toBe('brainstorm')
    })

    test('没 soft skill → noop', () => {
      mockRegistry.listSoftSkills.mockReturnValue([])
      const result = injector.tryActivate('sess1', 'whatever')
      expect(result.activated).toBe(false)
      expect(result.reason).toBe('no_soft_skills')
    })

    test('已有激活 → 不重新激活（noop）', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '4 阶段脑暴' }
      ])
      injector.tryActivate('sess1', '第一阶段')
      const r2 = injector.tryActivate('sess1', '第二阶段')
      expect(r2.activated).toBe(false)
      expect(r2.reason).toBe('noop_already_active')
    })

    test('"退出 brainstorm" 触发显式退激活', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '4 阶段脑暴' }
      ])
      injector.tryActivate('sess1', '来个创新需求')
      const r = injector.tryActivate('sess1', '算了退出 brainstorm')
      expect(r.activated).toBe(false)
      expect(r.reason).toBe('deactivated')
      expect(r.skillName).toBe('brainstorm')
    })

    test('forceActivate 显式激活', async () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '4 阶段脑暴' }
      ])
      injector.forceActivate('sess1', 'brainstorm')
      const section = await injector.buildInjectionSection('sess1')
      expect(section).not.toBe('')
      expect(section).toContain('brainstorm')
    })

    test('空消息不触发激活', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '创新脑暴' }
      ])
      const result = injector.tryActivate('sess1', '')
      expect(result.activated).toBe(false)
      expect(result.reason).toBe('no_match')
    })
  })

  describe('buildInjectionSection', () => {
    test('激活后返回完整 section 包含 Layer 2 body', async () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '完整 description 必须保留' }
      ])
      mockRegistry.getSkill.mockReturnValue({
        _mdBody: '## HARD-GATE\n未完成不允许输出'
      })
      mockResolver.parseSubFileRefs.mockReturnValue([])

      injector.tryActivate('sess1', '我想做创新')

      const section = await injector.buildInjectionSection('sess1')
      expect(section).toContain('完整 description 必须保留')  // Layer 1 完整 description
      expect(section).toContain('HARD-GATE')  // Layer 2 body
      expect(section).toContain('🔓 ACTIVE SKILL')
    })

    test('未激活返回空段', async () => {
      const section = await injector.buildInjectionSection('sess_none')
      expect(section).toBe('')
    })

    test('Layer 3 子文件加载并拼入 section', async () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '脑暴 description' }
      ])
      mockRegistry.getSkill.mockReturnValue({
        _mdBody: 'body [reference.md](reference.md)'
      })
      mockResolver.parseSubFileRefs.mockReturnValue(['reference.md'])
      mockSubFileResolver.loadSubFile.mockResolvedValue({
        success: true,
        content: '# REF CONTENT HERE'
      })

      injector.tryActivate('sess1', '创新需求')
      const section = await injector.buildInjectionSection('sess1')
      expect(section).toContain('REF CONTENT HERE')
    })
  })

  describe('cleanup', () => {
    test('清理 session 状态', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '4 阶段' }
      ])
      injector.tryActivate('sess1', '创新')
      injector.cleanup('sess1')
      const section = injector.buildInjectionSection('sess1')
      expect(section).toBe('')
    })
  })
})
