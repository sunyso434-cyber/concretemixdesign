/**
 * use_skill 元工具单元测试（技能目录式路由 · T2）
 *
 * agentHandler 用 jest.mock 工厂整体替换（对齐 skill-manager.triggerMode.test.js 模式），
 * 避免测试环境加载 Electron/DB 真实依赖；sessionLoadedSkills 用真实单例（reset 隔离）。
 */

// 对齐项目既有模式（UnifiedStrategy.test.js）：工厂内只引用 `mock` 前缀的 hoist 安全变量
let mockRegistry = null
jest.mock('../../ipcHandlers/agentHandler', () => {
  return { getSkillRegistry: () => mockRegistry }
})

const sessionLoadedSkills = require('../../agent/sessionLoadedSkills')
const useSkill = require('../../skills/use-skill')

function makeRegistry() {
  const skills = new Map()
  return {
    getSkill: (name) => skills.get(name) || null,
    getSkillSchema: (name) => {
      const s = skills.get(name)
      if (!s) return null
      return { type: 'function', function: { name: s.name, description: s.description } }
    },
    _put: (skill) => skills.set(skill.name, skill)
  }
}

describe('use_skill 元工具', () => {
  beforeEach(() => {
    sessionLoadedSkills.reset()
    mockRegistry = makeRegistry()
    mockRegistry._put({
      name: 'calculate_mix_design',
      description: '计算混凝土配合比',
      parameters: { strength: { type: 'string', required: true } },
      execute: () => {}
    })
    mockRegistry._put({
      name: 'brainstorm_method',
      description: '头脑风暴方法论',
      parameters: {},
      _isMDSkill: true,
      _triggerMode: 'soft'
    })
  })

  test('正常加载：返回完整说明 + schema + 登记会话集合', async () => {
    const result = await useSkill.execute(
      { name: 'calculate_mix_design' },
      {},
      { sessionId: 'sess-1' }
    )
    expect(result.success).toBe(true)
    expect(result.data.loaded).toBe('calculate_mix_design')
    expect(result.data.description).toBe('计算混凝土配合比')
    expect(result.data.schema.function.name).toBe('calculate_mix_design')
    expect(sessionLoadedSkills.has('sess-1', 'calculate_mix_design')).toBe(true)
  })

  test('重复加载：幂等成功，不产生副作用异常', async () => {
    await useSkill.execute({ name: 'calculate_mix_design' }, {}, { sessionId: 'sess-1' })
    const again = await useSkill.execute({ name: 'calculate_mix_design' }, {}, { sessionId: 'sess-1' })
    expect(again.success).toBe(true)
    expect(sessionLoadedSkills.get('sess-1')).toEqual(['calculate_mix_design'])
  })

  test('技能不存在：success=false + 引导看目录，不登记', async () => {
    const result = await useSkill.execute({ name: 'no_such_skill' }, {}, { sessionId: 'sess-1' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
    expect(sessionLoadedSkills.has('sess-1', 'no_such_skill')).toBe(false)
  })

  test('soft 方法论技能：拒绝加载并解释原因，不登记', async () => {
    const result = await useSkill.execute({ name: 'brainstorm_method' }, {}, { sessionId: 'sess-1' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('方法论技能')
    expect(sessionLoadedSkills.has('sess-1', 'brainstorm_method')).toBe(false)
  })

  test('无 runtimeCtx.sessionId：仍能加载成功（只是不登记）', async () => {
    const result = await useSkill.execute({ name: 'calculate_mix_design' }, {})
    expect(result.success).toBe(true)
  })
})
