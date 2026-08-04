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
      injector.forceActivate('sess1', 'brainstorm')
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

    test('不匹配任何 soft skill 的消息 → 不激活（不兜底硬塞第一个，P0 修复）', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '4 阶段脑暴创新方案' }
      ])
      // 消息跟 description 完全不沾边，旧逻辑会兜底激活 brainstorm，新逻辑返回 no_match
      const result = injector.tryActivate('sess1', '今天天气不错')
      expect(result.activated).toBe(false)
      expect(result.reason).toBe('no_match')
    })

    test('tryActivate 激活后 active 状态含 userMessage（B-2 参数来源）', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '低碳创新脑暴' }
      ])
      injector.tryActivate('sess1', '我要做个低碳混凝土')
      // 直接读 active 状态验证 userMessage 已存入
      const active = injector._activeSkill.get('sess1')
      expect(active).toBeTruthy()
      expect(active.userMessage).toBe('我要做个低碳混凝土')
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

      injector.forceActivate('sess1', 'brainstorm')

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

      injector.forceActivate('sess1', 'brainstorm')
      const section = await injector.buildInjectionSection('sess1')
      expect(section).toContain('REF CONTENT HERE')
    })

    test('soft skill body 的 {{userMessage}} 占位符被激活时存的 userMessage 替换（B-2 渲染）', async () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '低碳创新脑暴' }
      ])
      mockRegistry.getSkill.mockReturnValue({
        _mdBody: '用户原话：{{userMessage}}\n未匹配的占位符保留：{{undefined_param}}'
      })
      mockResolver.parseSubFileRefs.mockReturnValue([])

      // tryActivate 时 message 存进 active.userMessage，注入时用于渲染 {{userMessage}}
      injector.tryActivate('sess1', '我要做个低碳混凝土')
      const section = await injector.buildInjectionSection('sess1')
      expect(section).toContain('用户原话：我要做个低碳混凝土')  // {{userMessage}} 被替换
      expect(section).toContain('{{undefined_param}}')  // 找不到值原样保留
    })
  })

  describe('cleanup', () => {
    test('清理 session 状态', () => {
      mockRegistry.listSoftSkills.mockReturnValue([
        { name: 'brainstorm', description: '4 阶段' }
      ])
      injector.forceActivate('sess1', 'brainstorm')
      injector.cleanup('sess1')
      const section = injector.buildInjectionSection('sess1')
      expect(section).toBe('')
    })
  })
})
