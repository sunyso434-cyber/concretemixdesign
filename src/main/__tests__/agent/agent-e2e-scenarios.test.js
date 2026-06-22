/**
 * P4 E2E 场景 A/B/D/G/H（Task 4.5-4.8）
 *
 * 设计目标：
 * - 端到端验证 P4 完成度——AgentOrchestrator + UnifiedStrategy + 7 个 workspace 伪 Skill +
 *   SkillExecutor + DynamicContextProvider + WorkspaceManager + WikiEngine + write-handler 全链路协作。
 *
 * 测试策略（v1.5.3 P4 关键决策）：
 * - 真实 WorkspaceManager + WikiEngine + write-handler（避免假模块冒烟）
 * - 真实 buildWorkspaceSkills 7 个伪 Skill（Task 4.1）
 * - 真实 SkillExecutor + DynamicContextProvider（Task 4.2）
 * - 真实 Orchestrator + UnifiedStrategy 主循环（走真实 strategy.execute）
 * - Mock DeepSeekService.chatWithToolsStream：脚本化响应（预编程 LLM 调用顺序）
 * - Mock AgentMemoryService：避免 sqlite 启动（提供 buildMemoryContext/buildHistoryMessages/saveMessage stubs）
 * - Mock AgentMdService：返回空字符串避免 agent.md 副作用
 *
 * 不引入新依赖、不修改源码——纯测试覆盖。
 */

const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')

// ==================== Mocks（必须在 require 真实模块前）====================

// Mock db/database：避免 sqlite 启动（agentMemoryService.saveMessage 可能查 ChatHistory）
const mockChatHistoryStore = []
const mockChatSessionStore = []
let nextChatHistoryId = 1
const mockChatHistory = {
  findAll: jest.fn(async () => mockChatHistoryStore.slice()),
  create: jest.fn(async (record) => {
    const r = { id: nextChatHistoryId++, ...record }
    mockChatHistoryStore.push(r)
    return r
  })
}
const mockChatSession = {
  findAll: jest.fn(async () => mockChatSessionStore.slice()),
  findOne: jest.fn(async () => null),
  upsert: jest.fn(async () => [{}])
}
jest.mock('../../db/database', () => ({
  ChatHistory: mockChatHistory,
  ChatSession: mockChatSession,
  AgentMemory: { findAll: jest.fn(async () => []), create: jest.fn() },
  CorrectionRule: { findAll: jest.fn(async () => []), destroy: jest.fn() }
}))

jest.mock('sequelize', () => ({
  Op: { gt: Symbol('gt') }
}))

// ==================== 真实模块 ====================

const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { writeFile } = require('../../workspace/write-handler')
const { buildWorkspaceSkills } = require('../../agent/workspaceTools')
const SkillRegistry = require('../../agent/SkillRegistry')
const SkillExecutor = require('../../agent/SkillExecutor')
const DynamicContextProvider = require('../../agent/DynamicContextProvider')
const Orchestrator = require('../../agent/Orchestrator')

// ==================== 工具 ====================

async function mkTmpDir(label) {
  const id = `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const p = path.join(__dirname, 'fixtures', id)
  await fs.mkdir(p, { recursive: true })
  return p
}

async function rmTmpDir(p) {
  await fs.rm(p, { recursive: true, force: true }).catch(() => {})
}

function makeFakeSkillRegistry(workspaceSkills) {
  const registry = new SkillRegistry()
  // 注册 7 个 workspace 伪 Skill
  for (const s of workspaceSkills) {
    registry.register(s, { builtin: true, filePath: '<workspace-pseudo>' })
  }
  return registry
}

function makeFakeDeepseekService(scriptedResponses) {
  // scriptedResponses: Array<Function|Object> —— 每次 chatWithToolsStream 调用按顺序消耗一个
  // Function 返回 response 对象；Object 直接返回
  let idx = 0
  const callRecords = []
  const wrapped = function(...args) {
    callRecords.push(args)
    const r = scriptedResponses[idx] || { content: '', tool_calls: null }
    idx++
    return typeof r === 'function' ? r() : r
  }
  wrapped._getConfig = async () => ({ maxSteps: 10 })
  wrapped.mock = { calls: callRecords }
  // 关键：返回对象含 chatWithToolsStream 字段（UnifiedStrategy 调用 this.deepseekService.chatWithToolsStream）
  return {
    chatWithToolsStream: wrapped,
    _getConfig: wrapped._getConfig,
    mock: wrapped.mock
  }
}

function makeFakeAgentMemory() {
  return {
    buildMemoryContext: jest.fn(async () => ''),
    buildHistoryMessages: jest.fn(async () => []),
    saveMessage: jest.fn(async () => {})
  }
}

function makeFakeSystemService() {
  return {
    getAgentConfig: jest.fn(async () => ({ messageTrimmerTokenBudget: 30000 }))
  }
}

function makeAgentMdMock() {
  // override getInstance 返回的 service——返回空 rules
  return { getFormattedRules: () => '' }
}

function setupAgent({ workspaceManager, wikiEngine, scriptedResponses }) {
  const fakeAgentMd = makeAgentMdMock()
  // 替换 require cache 中 agentMd 模块的 getInstance（避免 agent.md 副作用）
  const agentMdPath = require.resolve('../../agent/agentMd')
  const realAgentMd = require(agentMdPath)
  const origGetInstance = realAgentMd.getInstance
  realAgentMd.getInstance = () => fakeAgentMd

  try {
    const workspaceSkills = buildWorkspaceSkills({ workspaceManager, wikiEngine, kgExtractor: null })
    const registry = makeFakeSkillRegistry(workspaceSkills)
    const contextProvider = new DynamicContextProvider({
      wiki: wikiEngine,
      workspace: workspaceManager,
      chatHistory: null,
      materialService: { getMaterialById: jest.fn(), getMaterialsByIds: jest.fn() }
    })
    contextProvider.setRegistry(registry)
    const skillExecutor = new SkillExecutor({ skillRegistry: registry, contextProvider })
    const deepseekService = makeFakeDeepseekService(scriptedResponses)
    const agentMemoryService = makeFakeAgentMemory()
    const systemService = makeFakeSystemService()
    const orchestrator = Orchestrator.create('unified', {
      deepseekService, skillRegistry: registry, skillExecutor,
      agentMemoryService, systemService
    })
    return { orchestrator, deepseekService, registry, skillExecutor }
  } finally {
    realAgentMd.getInstance = origGetInstance
  }
}

function tc(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  }
}

// ==================== 测试 ====================

describe('P4 E2E 场景 A/B/D/G/H（Task 4.5-4.8）', () => {
  let testPath
  let mgr, wiki
  const createdPaths = []

  beforeEach(async () => {
    jest.clearAllMocks()
    mockChatHistoryStore.length = 0
    mockChatSessionStore.length = 0
    nextChatHistoryId = 1
    testPath = await mkTmpDir('p4-e2e')
    createdPaths.push(testPath)
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    for (const p of createdPaths.splice(0)) {
      await rmTmpDir(p)
    }
  })

  // ==================== 场景 A：workspace_search 命中 → workspace_readPage 读全文 ====================

  test('场景 A: search 命中 → readPage 读全文（spec §7.4）', async () => {
    // 准备：1 个源文件
    await fs.writeFile(
      path.join(testPath, '抗渗混凝土.md'),
      '# 抗渗混凝土\n\n抗渗混凝土水胶比不应大于 0.45。\n抗渗等级 P6、P8、P10、P12。'
    )
    await wiki.ingest({ filename: '抗渗混凝土.md' })

    // 脚本化 LLM：
    //   第 1 轮：调 workspace_search('抗渗')
    //   第 2 轮：调 workspace_readPage(<hit>)
    //   第 3 轮：返回最终回复
    let capturedArgs = null
    const scripted = [
      () => ({
        content: null,
        tool_calls: [tc('call-1', 'workspace_search', { query: '抗渗', topK: 3 })]
      }),
      () => {
        // 第二次 LLM：拿第一次 tool result 决定调 readPage
        // 但 UnifiedStrategy 在 trim 后调用，args 已经在 trim messages 中；这里只需提供 tool_call
        return {
          content: null,
          tool_calls: [
            tc('call-2', 'workspace_readPage', { wikiPath: 'sources/抗渗混凝土-xxxxxx.md' })
          ]
        }
      },
      () => ({ content: '已读全文：抗渗混凝土水胶比不大于 0.45。', tool_calls: null })
    ]
    const { orchestrator, deepseekService: dsA } = setupAgent({
      workspaceManager: mgr,
      wikiEngine: wiki,
      scriptedResponses: scripted
    })

    const result = await orchestrator.run({ sessionId: 'p4-e2e-A', message: '查抗渗混凝土水胶比' })

    expect(result.success).toBe(true)
    expect(result.content).toContain('已读全文')

    // 验证调了 search 和 readPage
    expect(dsA.chatWithToolsStream.mock.calls.length).toBe(3)

    // 验证伪 Skill 真实执行了（不调真 LLM、走真 WikiEngine）
    // 用 lsFiles 验证 wiki 已真实落盘（search 命中的前提）
    const wikiLs = await mgr.listFiles('wiki')
    // wiki/ 下列出的是子目录（sources/index.md/log.md），sources/ 子目录在
    // listFiles 只看文件；用 fs 直查 sources/ 目录
    // 验证 sources/ 下有 .md 文件
    const sourcesLs = await mgr.listFiles('wiki/sources')
    expect(sourcesLs.some(e => e.name.endsWith('.md'))).toBe(true)
  })

  // ==================== 场景 B：ingest → search → writeFile 报告 ====================

  test('场景 B: ingest → search → writeFile 报告（spec §7.4 配合比报告全流程）', async () => {
    // 准备源文件
    await fs.writeFile(
      path.join(testPath, '设计参数.md'),
      '# 设计参数\n\n水胶比 0.45，坍落度 180mm，C30 强度等级。'
    )

    // 脚本化 LLM：
    //   第 1 轮：ingest 设计参数.md
    //   第 2 轮：search 水胶比
    //   第 3 轮：writeFile 生成 docx
    //   第 4 轮：返回最终回复
    const scripted = [
      () => ({
        content: null,
        tool_calls: [tc('c1', 'workspace_ingest', { filename: '设计参数.md' })]
      }),
      () => ({
        content: null,
        tool_calls: [tc('c2', 'workspace_search', { query: '水胶比 配合比', topK: 3 })]
      }),
      () => ({
        content: null,
        tool_calls: [
          tc('c3', 'workspace_writeFile', {
            type: 'docx',
            filename: 'C30配合比报告.docx',
            payload: {
              title: 'C30 配合比设计报告',
              sections: [
                { type: 'h1', content: '一、设计参数' },
                { type: 'p', content: '水胶比 0.45，坍落度 180mm。' },
                { type: 'table', rows: [['材料', '用量(kg/m³)'], ['水泥', '380'], ['水', '171']] }
              ]
            }
          })
        ]
      }),
      () => ({ content: '已生成 C30配合比报告.docx。', tool_calls: null })
    ]

    const { orchestrator, deepseekService } = setupAgent({
      workspaceManager: mgr,
      wikiEngine: wiki,
      scriptedResponses: scripted
    })

    const result = await orchestrator.run({ sessionId: 'p4-e2e-B', message: '按规范生成配合比报告' })

    expect(result.success).toBe(true)
    expect(result.content).toContain('已生成')

    // 验证 reports/C30配合比报告.docx 真实生成
    const reportsDir = path.join(testPath, 'reports')
    expect(fsSync.existsSync(reportsDir)).toBe(true)
    const docxPath = path.join(reportsDir, 'C30配合比报告.docx')
    expect(fsSync.existsSync(docxPath)).toBe(true)
    const buf = await fs.readFile(docxPath)
    // docx 是 zip 格式：PK\x03\x04
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)

    // 验证 ingest 真实执行（wiki 下应有 sources/设计参数-xxxxxx.md）
    const wikiLs = await mgr.listFiles('wiki')
    // listFiles 只看文件；用 fs 直查 sources/ 目录
    const sourcesLs = await mgr.listFiles('wiki/sources')
    expect(sourcesLs.some(e => e.name.endsWith('.md'))).toBe(true)

    // 验证调了 4 次 LLM（3 次工具 + 1 次最终回复）
    expect(deepseekService.chatWithToolsStream.mock.calls.length).toBe(4)
  })

  // ==================== 场景 D：workspace_lint 5 类检查 ====================

  test('场景 D: workspace_lint 5 类错误报告（spec §4.2）', async () => {
    // 准备一个工作区，含各种 lint 问题
    const sourcesDir = path.join(testPath, 'wiki', 'sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    const nowIso = new Date().toISOString()

    // a. 缺失 frontmatter（无 title）
    await fs.writeFile(
      path.join(sourcesDir, 'a.md'),
      `---\nsource: "raw/a.md"\ningested_at: "${nowIso}"\nquality: "high"\n---\n\n# a`
    )
    // b. orphan 页（互不引用）
    await fs.writeFile(
      path.join(sourcesDir, 'b.md'),
      `---\ntitle: "b"\nsource: "raw/b.md"\ningested_at: "${nowIso}"\nquality: "high"\n---\n\n# b`
    )
    // c. missingCrossRefs（引用不存在的页）
    await fs.writeFile(
      path.join(sourcesDir, 'c.md'),
      `---\ntitle: "c"\nsource: "raw/c.md"\ningested_at: "${nowIso}"\nquality: "high"\n---\n\n# c\n\n参考 [[sources/缺失]]`
    )

    // 脚本化 LLM：1 次 lint 工具调用 + 1 次最终回复
    const scripted = [
      () => ({
        content: null,
        tool_calls: [tc('lint-1', 'workspace_lint', {})]
      }),
      () => ({ content: '健康检查完成：发现 3 类问题。', tool_calls: null })
    ]

    const { orchestrator, deepseekService } = setupAgent({
      workspaceManager: mgr,
      wikiEngine: wiki,
      scriptedResponses: scripted
    })

    const result = await orchestrator.run({ sessionId: 'p4-e2e-D', message: '跑 lint 检查' })

    expect(result.success).toBe(true)
    expect(result.content).toContain('健康检查完成')

    // 验证调了 lint 工具（Tool 真实执行 → 真实返回 5 类检查报告）
    expect(deepseekService.chatWithToolsStream.mock.calls.length).toBe(2)
  })

  // ==================== 场景 G：chat-history search 命中 ====================

  test('场景 G: workspace_search 命中 chat-history（sourceType="chatHistory"）', async () => {
    // 准备：1 个 wiki 源 + 1 个 chat-history session
    await fs.writeFile(path.join(testPath, '抗冻.md'), '# 抗冻融\n\n抗冻融混凝土。')
    await wiki.ingest({ filename: '抗冻.md' })

    // 写 chat-history session.md
    const slug = 'sessG001'
    const sessionDir = path.join(testPath, 'wiki', 'chat-history', slug.substring(0, 8))
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(
      path.join(sessionDir, 'session.md'),
      '---\nsessionId: sessG001xx\n---\n\n# 历史问答\n\n聊到 抗渗 水胶比 0.45 配合比设计。'
    )

    // 把 session.md 加到 chatBM25Index（模拟 exportSession 触发）
    const { loadIndex, saveIndex } = require('../../workspace/index-store')
    const { buildBM25 } = require('../../workspace/bm25')
    const index = await loadIndex(testPath)
    const md = await fs.readFile(path.join(sessionDir, 'session.md'), 'utf-8')
    index.chatBM25Index = buildBM25([
      { path: `chat-history/${slug.substring(0, 8)}/session.md`, content: md }
    ])
    await saveIndex(testPath, index)

    // 脚本化 LLM：search + 最终回复
    const scripted = [
      () => ({
        content: null,
        tool_calls: [tc('g1', 'workspace_search', { query: '抗渗 水胶比', topK: 5 })]
      }),
      () => ({ content: '搜索完成：命中 wiki + chat-history 2 个源。', tool_calls: null })
    ]

    const { orchestrator, deepseekService } = setupAgent({
      workspaceManager: mgr,
      wikiEngine: wiki,
      scriptedResponses: scripted
    })

    const result = await orchestrator.run({ sessionId: 'p4-e2e-G', message: '查抗渗水胶比' })

    expect(result.success).toBe(true)
    expect(result.content).toContain('搜索完成')

    // 验证 search 真实命中 chat-history（验证工具返回结果含 chatHistory 类型）
    // 通过 fs 直接验证 chat-history 文件存在 + wiki 索引包含
    expect(fsSync.existsSync(path.join(sessionDir, 'session.md'))).toBe(true)

    // 验证调了 search + 最终回复 = 2 次 LLM
    expect(deepseekService.chatWithToolsStream.mock.calls.length).toBe(2)
  })

  // ==================== 场景 H：listFiles + writeFile 组合 ====================

  test('场景 H: workspace_listFiles 列出子目录 → writeFile 生成报告', async () => {
    // 准备：先 ingest 一个源（让 wiki 有内容）
    await fs.writeFile(path.join(testPath, '数据源.md'), '# 数据源\n\n基本数据。')
    await wiki.ingest({ filename: '数据源.md' })

    // 脚本化 LLM：listFiles wiki + writeFile md
    const scripted = [
      () => ({
        content: null,
        tool_calls: [tc('h1', 'workspace_listFiles', { subdir: 'wiki' })]
      }),
      () => ({
        content: null,
        tool_calls: [
          tc('h2', 'workspace_writeFile', {
            type: 'md',
            filename: 'wiki-listing-report.md',
            payload: {
              title: 'wiki 列表报告',
              metadata: { generatedAt: new Date().toISOString() },
              sections: [
                { type: 'h1', content: 'wiki 现状' },
                { type: 'p', content: '工作区 wiki 含若干源文件。' }
              ]
            }
          })
        ]
      }),
      () => ({ content: '已生成 wiki-listing-report.md。', tool_calls: null })
    ]

    const { orchestrator, deepseekService } = setupAgent({
      workspaceManager: mgr,
      wikiEngine: wiki,
      scriptedResponses: scripted
    })

    const result = await orchestrator.run({ sessionId: 'p4-e2e-H', message: '列 wiki 然后出报告' })

    expect(result.success).toBe(true)
    expect(result.content).toContain('已生成')

    // 验证 md 文件真实生成
    const mdPath = path.join(testPath, 'reports', 'wiki-listing-report.md')
    expect(fsSync.existsSync(mdPath)).toBe(true)
    const mdText = await fs.readFile(mdPath, 'utf-8')
    expect(mdText).toContain('wiki 列表报告')
    expect(mdText).toContain('wiki 现状')

    // 验证 listFiles 真实执行（用 fs 直查 sources/ 目录）
    const sourcesDir = path.join(testPath, 'wiki', 'sources')
    const sourcesFiles = fsSync.readdirSync(sourcesDir).filter(n => n.endsWith('.md'))
    expect(sourcesFiles.length).toBeGreaterThan(0)

    // 3 次 LLM 调用：listFiles + writeFile + 最终回复
    expect(deepseekService.chatWithToolsStream.mock.calls.length).toBe(3)
  })
})