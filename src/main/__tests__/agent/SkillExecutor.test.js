const SkillExecutor = require('../../agent/SkillExecutor')

describe('SkillExecutor', () => {
  let executor, mockRegistry, mockContextProvider

  beforeEach(() => {
    mockRegistry = {
      getSkill: jest.fn(),
      skillNames: []
    }
    mockContextProvider = {
      getForSkill: jest.fn(() => ({}))
    }
    executor = new SkillExecutor({
      skillRegistry: mockRegistry,
      contextProvider: mockContextProvider
    })
  })

  describe('function 模式 MD skill 分流（P0 修复：任务 0.4）', () => {
    test('function 模式 MD skill 调 execute → 返回 body 文本，不抛 TypeError', async () => {
      // MD 技能没有 execute 函数（_loadMDSkill 不挂 execute），
      // 旧逻辑直接调 skill.execute → TypeError → UNKNOWN；
      // 新逻辑调 buildMDInstruction 渲染 body 作为工具结果。
      const mdSkill = {
        name: 'custom_md_skill',
        description: '自定义 MD 技能',
        parameters: {},
        _isMDSkill: true,
        _triggerMode: 'function',
        _mdBody: '## 步骤1\n执行任务 {{target}}'
        // 故意没有 execute 函数
      }
      mockRegistry.getSkill.mockReturnValue(mdSkill)

      const result = await executor.execute('custom_md_skill', { target: '混凝土' }, {})

      expect(result.success).toBe(true)
      expect(result.data.instruction).toContain('## 步骤1')
      expect(result.data.instruction).toContain('执行任务 混凝土')  // {{target}} 占位符渲染
      expect(result.data.instruction).toContain('子任务')  // buildMDInstruction 包装
      expect(result._meta.skill).toBe('custom_md_skill')
    })

    test('function 模式 MD skill 无参数时占位符原样保留', async () => {
      const mdSkill = {
        name: 'md_no_args',
        description: '无参数 MD 技能',
        parameters: {},
        _isMDSkill: true,
        _triggerMode: 'function',
        _mdBody: '指令 {{undefined_param}}'
      }
      mockRegistry.getSkill.mockReturnValue(mdSkill)

      const result = await executor.execute('md_no_args', {}, {})
      expect(result.success).toBe(true)
      expect(result.data.instruction).toContain('指令 {{undefined_param}}')  // 原样保留
    })

    test('soft 模式 MD skill 不走 function 分流（_triggerMode 判断精确）', async () => {
      // soft 模式 MD skill 不应被 SkillExecutor 直接调用（它是注入系统提示的）；
      // 若被误调，不应进 function 分流，会尝试 skill.execute（undefined）→ _handleError → UNKNOWN
      const softMdSkill = {
        name: 'soft_md',
        description: 'soft 技能',
        parameters: {},
        _isMDSkill: true,
        _triggerMode: 'soft',
        _mdBody: 'soft body'
      }
      mockRegistry.getSkill.mockReturnValue(softMdSkill)

      const result = await executor.execute('soft_md', {}, {})
      expect(result.success).toBe(false)  // 不走 function 分流，走原逻辑报错
    })

    test('JS skill 正常走 execute（不受 MD 分流影响）', async () => {
      const jsSkill = {
        name: 'js_skill',
        description: 'JS 技能',
        parameters: {},
        execute: jest.fn(async () => ({ success: true, data: 'js result' }))
      }
      mockRegistry.getSkill.mockReturnValue(jsSkill)

      const result = await executor.execute('js_skill', {}, {})
      expect(result.success).toBe(true)
      expect(result.data).toBe('js result')
      expect(jsSkill.execute).toHaveBeenCalled()
    })

    test('不存在的 skill → SKILL_NOT_FOUND（不受 MD 分流影响）', async () => {
      mockRegistry.getSkill.mockReturnValue(null)

      const result = await executor.execute('not_exist', {}, {})
      expect(result.success).toBe(false)
    })
  })
})
