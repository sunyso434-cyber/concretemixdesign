/**
 * toolExecutor 拦截自动展开单元测试（技能目录式路由 · T4）
 *
 * 直接构造最小 this 上下文调用导出的 _executeSingleTool/_emitToolCompletion，
 * sessionLoadedSkills 用真实单例（reset 隔离），不启动 Electron/DB。
 */

const { _executeSingleTool, _emitToolCompletion, _buildCachedToolMsg } = require('../strategies/toolExecutor')
const sessionLoadedSkills = require('../sessionLoadedSkills')

/**
 * 构造伪 UnifiedStrategy 上下文（_executeSingleTool 通过 this 访问实例属性）
 */
function makeHarness({ routingMode = 'catalog', registryExtras = {}, preloaded = [] } = {}) {
  const skills = new Map([
    ['calculate_mix_design', { name: 'calculate_mix_design', description: '计算配合比', parameters: {}, execute: () => {} }],
    ['workspace_search', { name: 'workspace_search', description: '搜索 wiki', parameters: {}, execute: () => {} }]
  ])
  const skillRegistry = {
    getSkill: (name) => skills.get(name) || null,
    getRoutingToolSchemas: () => [],
    isResident: (name) => name.startsWith('workspace_') || name === 'use_skill',
    getSkillSchema: (name) => {
      const s = skills.get(name)
      return s ? { type: 'function', function: { name: s.name, description: s.description } } : null
    },
    ...registryExtras
  }

  sessionLoadedSkills.reset()
  for (const name of preloaded) sessionLoadedSkills.load('sess-1', name)

  return {
    sessionId: 'sess-1',
    routingMode,
    skillRegistry,
    skillExecutor: { execute: jest.fn(async () => ({ success: true, data: {} })) },
    agentMemoryService: { saveMessage: jest.fn() },
    toolResultStore: { store: jest.fn(() => null) },
    _buildCachedToolMsg,
    _notifyProgress: jest.fn(),
    webContents: null,
    orchestrator: null,
    trimmedMessages: [],
    failureCounters: { llmParse: 0, llmNetwork: 0, skillExec: 0 },
    softWarnSent: {}
  }
}

function makeTc(name, args = {}) {
  return { id: 'call_1', function: { name, arguments: JSON.stringify(args) } }
}

describe('_executeSingleTool 拦截自动展开', () => {
  beforeEach(() => sessionLoadedSkills.reset())

  test('catalog 模式 + 未加载非常驻技能 → auto_loaded：不执行、登记、返回 schema 引导重调', async () => {
    const h = makeHarness()
    const r = await _executeSingleTool.call(h, makeTc('calculate_mix_design'), h)

    expect(r.kind).toBe('auto_loaded')
    expect(h.skillExecutor.execute).not.toHaveBeenCalled()
    expect(h.failureCounters.skillExec).toBe(0)
    expect(sessionLoadedSkills.has('sess-1', 'calculate_mix_design')).toBe(true)

    const content = JSON.parse(r.toolMsg.content)
    expect(content.needs_reload).toBe(true)
    expect(content.auto_loaded).toBe(true)
    expect(content.schema.function.name).toBe('calculate_mix_design')
    expect(content.note).toContain('重新调用')
  })

  test('会话已加载过的技能不再拦截，直接执行', async () => {
    const h = makeHarness({ preloaded: ['calculate_mix_design'] })
    const r = await _executeSingleTool.call(h, makeTc('calculate_mix_design'), h)

    expect(r.kind).toBe('ok')
    expect(h.skillExecutor.execute).toHaveBeenCalledTimes(1)
  })

  test("routingMode='full' 完全跳过拦截（旧行为直通执行）", async () => {
    const h = makeHarness({ routingMode: 'full' })
    const r = await _executeSingleTool.call(h, makeTc('calculate_mix_design'), h)

    expect(r.kind).toBe('ok')
    expect(h.skillExecutor.execute).toHaveBeenCalledTimes(1)
    expect(sessionLoadedSkills.has('sess-1', 'calculate_mix_design')).toBe(false)
  })

  test('常驻技能（workspace_* 等）直通执行不拦截', async () => {
    const h = makeHarness()
    const r = await _executeSingleTool.call(h, makeTc('workspace_search', { query: '水泥' }), h)

    expect(r.kind).toBe('ok')
    expect(h.skillExecutor.execute).toHaveBeenCalledTimes(1)
  })

  test('注册表缺新方法（旧式最小 mock）→ 整体降级直通', async () => {
    const h = makeHarness({
      registryExtras: {
        getRoutingToolSchemas: undefined,
        isResident: undefined,
        getSkillSchema: undefined
      }
    })
    delete h.skillRegistry.getRoutingToolSchemas
    delete h.skillRegistry.isResident
    delete h.skillRegistry.getSkillSchema

    const r = await _executeSingleTool.call(h, makeTc('calculate_mix_design'), h)
    expect(r.kind).toBe('ok')
    expect(h.skillExecutor.execute).toHaveBeenCalledTimes(1)
  })

  test('工具不存在 → missing 分支，hint 引导查看技能目录', async () => {
    const h = makeHarness()
    const r = await _executeSingleTool.call(h, makeTc('ghost_skill'), h)

    expect(r.kind).toBe('missing')
    const content = JSON.parse(r.toolMsg.content)
    expect(content.error).toContain('不存在')
    expect(content.hint).toContain('技能目录')
  })
})

describe('_emitToolCompletion auto_loaded 事件', () => {
  test("kind='auto_loaded' 发 tool_done（引导不算失败）", () => {
    const h = makeHarness()
    _emitToolCompletion.call(
      h,
      { tc: { id: 'c1' }, name: 'x_skill', args: {}, kind: 'auto_loaded' },
      { mode: 'agent', roundIndex: 0 }
    )
    expect(h._notifyProgress).toHaveBeenCalledWith(
      null,  // 第一参数为 webContents（测试桩里为 null）
      expect.objectContaining({ type: 'tool_done', result: { auto_loaded: true } })
    )
  })
})
