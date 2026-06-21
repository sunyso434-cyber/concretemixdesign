// DynamicContextProvider.workspace.test.js（Task 4.2）
// 测试 v1.5.3 关键决策：DynamicContextProvider.allServices 注入
// wiki/workspace/chatHistory，让 18 个 Skill 可选地通过
// context.wiki / context.workspace / context.chatHistory 访问 workspace 能力。
//
// 关键约束：
//   1) 不改 18 个 Skill 的 execute(args, context) 签名
//   2) wiki/workspace/chatHistory 来自 global（main.js 已注入）
//   3) P1 阶段为 null 时不抛错（容错）
//   4) 注入后通过 getServices / getForSkill 都可拿到

const DynamicContextProvider = require('../../agent/DynamicContextProvider')

function makeMockWiki() {
  return { search: jest.fn().mockResolvedValue([{ path: 'a.md', score: 1.0 }]) }
}
function makeMockWS() {
  return { open: jest.fn().mockResolvedValue({ ok: true }) }
}
function makeMockCH() {
  return { listSessions: jest.fn().mockResolvedValue([]) }
}

describe('DynamicContextProvider 注入 wiki/workspace/chatHistory（Task 4.2 - v1.5.3）', () => {
  test('getServices：skill 声明 services:["wiki","workspace","chatHistory"] → context 包含三个服务实例', () => {
    const fakeWiki = makeMockWiki()
    const fakeWS = makeMockWS()
    const fakeCH = makeMockCH()
    const provider = new DynamicContextProvider({
      wiki: fakeWiki,
      workspace: fakeWS,
      chatHistory: fakeCH,
      materialService: {}  // 业务服务保留
    })

    const skill = { name: 'test.skill', services: ['wiki', 'workspace', 'chatHistory'] }
    const ctx = provider.getServices(skill)

    expect(ctx.wiki).toBe(fakeWiki)
    expect(ctx.workspace).toBe(fakeWS)
    expect(ctx.chatHistory).toBe(fakeCH)
    // 基础服务仍在
    expect(ctx.logger).toBeDefined()
    expect(typeof ctx.findMaterialById).toBe('function')
  })

  test('getServices：skill 声明 services:[] → context 不包含 wiki/workspace/chatHistory（按需注入）', () => {
    const provider = new DynamicContextProvider({
      wiki: makeMockWiki(),
      workspace: makeMockWS(),
      chatHistory: makeMockCH(),
      materialService: {}
    })

    const skill = { name: 'pure.skill', services: [] }
    const ctx = provider.getServices(skill)

    // services:[] → 不注入任何业务服务（包括 workspace 三件套）
    expect(ctx.wiki).toBeUndefined()
    expect(ctx.workspace).toBeUndefined()
    expect(ctx.chatHistory).toBeUndefined()
  })

  test('getServices：allServices.wiki=null → context.wiki 不存在（不抛错，falsey skip）', () => {
    const provider = new DynamicContextProvider({
      wiki: null,  // P1 阶段为 null
      workspace: null,
      chatHistory: null,
      materialService: {}
    })

    const skill = { name: 'test.skill', services: ['wiki', 'workspace', 'chatHistory'] }
    const ctx = provider.getServices(skill)

    // 注入逻辑：if (this.allServices[serviceName]) 跳过 null
    expect(ctx.wiki).toBeUndefined()
    expect(ctx.workspace).toBeUndefined()
    expect(ctx.chatHistory).toBeUndefined()
    // 不抛错
    expect(ctx.logger).toBeDefined()
  })

  test('getForSkill：通过 skillName 从 registry 查到 skill → 注入 wiki/workspace/chatHistory', () => {
    const fakeWiki = makeMockWiki()
    const fakeWS = makeMockWS()
    const fakeCH = makeMockCH()

    // 模拟 SkillRegistry
    const fakeRegistry = {
      getSkill: jest.fn().mockReturnValue({
        name: 'workspace.aware',
        services: ['wiki', 'workspace', 'chatHistory']
      })
    }

    const provider = new DynamicContextProvider({
      wiki: fakeWiki,
      workspace: fakeWS,
      chatHistory: fakeCH,
      materialService: {}
    })
    provider.setRegistry(fakeRegistry)

    const ctx = provider.getForSkill('workspace.aware')

    expect(fakeRegistry.getSkill).toHaveBeenCalledWith('workspace.aware')
    expect(ctx.wiki).toBe(fakeWiki)
    expect(ctx.workspace).toBe(fakeWS)
    expect(ctx.chatHistory).toBe(fakeCH)
  })

  test('getForSkill：registry 找不到 skill → _createFullContext（含全部服务，含 wiki/workspace/chatHistory）', () => {
    const fakeWiki = makeMockWiki()
    const fakeWS = makeMockWS()
    const fakeCH = makeMockCH()

    const fakeRegistry = { getSkill: jest.fn().mockReturnValue(null) }

    const provider = new DynamicContextProvider({
      wiki: fakeWiki,
      workspace: fakeWS,
      chatHistory: fakeCH,
      materialService: { stub: true }
    })
    provider.setRegistry(fakeRegistry)

    const ctx = provider.getForSkill('ghost.skill')

    // _createFullContext 用 spread 把 allServices 展开 → 全部服务都注入
    expect(ctx.wiki).toBe(fakeWiki)
    expect(ctx.workspace).toBe(fakeWS)
    expect(ctx.chatHistory).toBe(fakeCH)
    expect(ctx.materialService).toEqual({ stub: true })
  })

  test('allServices 上 wiki/workspace/chatHistory 是 public（agentHandler.js 可读）', () => {
    // 这条测试是契约测试：保护 allServices 的 key 名不被改
    const provider = new DynamicContextProvider({
      wiki: makeMockWiki(),
      workspace: makeMockWS(),
      chatHistory: makeMockCH(),
      materialService: {}
    })

    expect(provider.allServices).toHaveProperty('wiki')
    expect(provider.allServices).toHaveProperty('workspace')
    expect(provider.allServices).toHaveProperty('chatHistory')
  })
})
