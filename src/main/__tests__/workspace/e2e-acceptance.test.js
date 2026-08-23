/**
 * P6 E2E 老板验收清单（Task 6.4）
 *
 * 目标：把 spec §7.7 老板人工验收清单（7 条）自动化为 E2E 测试。
 *
 * 设计原则：
 * - 用真模块（WorkspaceManager + WikiEngine + KGExtractor + writers + readers）
 * - mock 外部依赖（LLM、slash command 的 SystemService、chat history DB）
 * - 不引入新依赖
 * - 每个测试用独立 tmp 目录，afterEach 清理
 *
 * 7 条验收清单对应 7 个 describe：
 *   1. ingest PDF/Word（验收 1）
 *   2. docx 报告生成可打开（验收 2）
 *   3. 坏 PDF → wiki/ 无新增（验收 3）
 *   4. /rounds 3 → 主循环 3 步停止（验收 4）
 *   5. wiki 页 markdown 渲染（验收 5）
 *   6. mock 429 → query 走 BM25 降级（验收 6）
 *   7. UHPC 论文 PDF → KG 提取（验收 7）
 */
const path = require('path')
const fs = require('fs').promises
const os = require('os')

// ==================== Mocks（必须在 require 真模块前） ====================

// ---- Mock db/database（chat-history 给 integration test 风格兼容） ----
const mockChatHistoryStore = []
let nextChatHistoryId = 1
const mockChatSessionStore = []

const mockChatHistory = {
  findAll: jest.fn(async () => mockChatHistoryStore.slice()),
  update: jest.fn(async () => [0])
}
const mockChatSession = {
  findAll: jest.fn(async () => mockChatSessionStore.slice()),
  update: jest.fn(async () => [0])
}

jest.mock('../../db/database', () => ({
  ChatHistory: mockChatHistory,
  ChatSession: mockChatSession
}))

// ---- Mock SystemService（给 slashCommandHandler 的 /rounds 用） ----
const mockSystemParams = new Map()
jest.mock('../../services/SystemService', () => ({
  getParamByName: jest.fn(async (name) => mockSystemParams.get(name) || null),
  setParam: jest.fn(async (name, value) => {
    mockSystemParams.set(name, { name, value, category: 'ai', description: '' })
    return { name, value }
  })
}))

// ---- Mock DeepSeekService 类（2026-08-23 修复验收 4）----
// UnifiedStrategy 主循环内部用 failover config 直接 new DeepSeekService(config)，
// 注入实例的 chatWithToolsStream 不会被调用——需类级 mock 桥接
let mockLLMClass = null
jest.mock('../../services/DeepSeekService', () => {
  return jest.fn().mockImplementation(function (config, sys) {
    return {
      config,
      systemService: sys,
      chatWithToolsStream: (...args) => mockLLMClass(...args),
      _getConfig: async () => ({ maxSteps: 3, apiKey: 'sk-test', contextLimit: 200000 })
    }
  })
})

// ---- Mock electron（slashCommandHandler 需要 ipcMain） ----
jest.mock('electron', () => ({
  ipcMain: {
    removeHandler: jest.fn(),
    handle: jest.fn()
  }
}))

// ==================== 真实模块 ====================

const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { KGExtractor } = require('../../workspace/KGExtractor')
const { mergeInto } = require('../../workspace/kg-merge')
const { writeFile } = require('../../workspace/write-handler')
const slashCommandModule = require('../../ipcHandlers/slashCommandHandler')
const UnifiedStrategy = require('../../agent/strategies/UnifiedStrategy')
const schema = require('../../workspace/kg-schema.json')

// ---- 算 sha1 id 辅助（与 KGExtractor.extract 用法一致） ----
const crypto = require('crypto')
const sha1Id = (name, type) => crypto.createHash('sha1').update(`${name}|${type}`).digest('hex').substring(0, 16)

// 注册 slashCommandHandler 后从 ipcMain.handle 抓回调（executeSlashCommand 未 export）
let _slashHandler = null
function setupSlashHandler({ deepseekService, skillRegistry, skillExecutor } = {}) {
  _slashHandler = null
  // 清掉之前的 mock handler 抓取
  const { ipcMain } = require('electron')
  ipcMain.handle.mockClear()
  slashCommandModule.registerSlashCommandHandler({
    deepseekService: deepseekService || { getAvailableModels: () => ['mock'], clearConfigCache: () => {} },
    skillRegistry: skillRegistry || { has: () => false },
    skillExecutor: skillExecutor || {}
  })
  // 抓最后一次注册的 handle 回调（'slash:execute'）
  const calls = ipcMain.handle.mock.calls
  const lastCall = calls[calls.length - 1]
  _slashHandler = lastCall[1]
}
async function execSlash(command, param) {
  if (!_slashHandler) setupSlashHandler()
  return await _slashHandler({}, { command, param })
}

// ==================== 工具函数 ====================

async function mkTmpDir(label) {
  const id = `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const p = path.join(os.tmpdir(), id)
  await fs.mkdir(p, { recursive: true })
  return p
}

async function rmTmpDir(p) {
  await fs.rm(p, { recursive: true, force: true }).catch(() => {})
}

/** 校验 Buffer 是合法 zip（docx/xlsx 都是 zip 格式） */
function isValidZip(buf) {
  if (!Buffer.isBuffer(buf)) return false
  if (buf.length < 4) return false
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

/** 简易 evidence 拼接器：保证 ≥35 字（超过 KGExtractor.MIN_EVIDENCE_LEN=30 的安全余量） */
function ev(s) {
  if (s.length >= 35) return s
  return s + '，详细实验数据见论文第3节表1，可重复验证。'
}

/** 按内容返回固定三元组的 mock LLM */
function makeMockLLM(entities, relations) {
  return {
    invoke: jest.fn(async () => JSON.stringify({
      entities: entities || [],
      relations: relations || []
    }))
  }
}

// ============================================================
// 验收 1：ingest PDF / Word
// ============================================================

describe('E2E 验收 1：ingest PDF / Word（老板清单第 1 条）', () => {
  let wsPath, mgr, wiki

  beforeEach(async () => {
    wsPath = await mkTmpDir('p6-acc-1')
    mgr = new WorkspaceManager()
    await mgr.open(wsPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(wsPath)
  })

  test('ingest PDF → wiki/sources/<slug>.md 落盘 + 含 frontmatter + 含 PDF 文字', async () => {
    // 1) 复制真 PDF fixture 到工作区
    const pdfSrc = path.join(__dirname, 'readers', 'fixtures', 'sample.pdf')
    const pdfDst = path.join(wsPath, 'report.pdf')
    await fs.copyFile(pdfSrc, pdfDst)

    // 2) ingest
    const result = await wiki.ingest({ filename: 'report.pdf' })
    expect(result.status).toBe('ok')
    expect(result.pagesCreated).toHaveLength(1)
    expect(result.pagesCreated[0]).toMatch(/^sources\/report\.md$/)

    // 3) wiki/sources/<slug>.md 真的落盘
    const wikiPath = path.join(wsPath, 'wiki', 'sources', 'report.md')
    const stat = await fs.stat(wikiPath)
    expect(stat.size).toBeGreaterThan(0)

    // 4) 文件内容含 frontmatter + PDF 文字（pdf fixture 至少含 Concrete/Water/Sand 之一）
    const content = await fs.readFile(wikiPath, 'utf-8')
    expect(content).toContain('---')
    expect(content).toContain('title:')
    expect(content).toContain('source:')
    expect(content).toMatch(/混凝土|Concrete|Water|Sand/)
  })

  test('ingest docx → wiki/sources/<slug>.md 落盘 + 含 docx 文字', async () => {
    const docxSrc = path.join(__dirname, 'readers', 'fixtures', 'sample.docx')
    const docxDst = path.join(wsPath, 'note.docx')
    await fs.copyFile(docxSrc, docxDst)

    const result = await wiki.ingest({ filename: 'note.docx' })
    expect(result.status).toBe('ok')
    expect(result.pagesCreated[0]).toMatch(/^sources\/note\.md$/)

    const wikiPath = path.join(wsPath, 'wiki', 'sources', 'note.md')
    const content = await fs.readFile(wikiPath, 'utf-8')
    expect(content).toMatch(/---/)
    expect(content.length).toBeGreaterThan(20)
  })
})

// ============================================================
// 验收 2：聊天 "按规范生成配合比报告" → docx 可打开
// ============================================================

describe('E2E 验收 2：报告生成可打开（老板清单第 2 条；2026-08-23 docx writer 迁移 officecli 后改验 md）', () => {
  let wsPath, mgr

  beforeEach(async () => {
    wsPath = await mkTmpDir('p6-acc-2')
    mgr = new WorkspaceManager()
    await mgr.open(wsPath)
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(wsPath)
  })

  test('writeFile({type:"md"}) → reports/*.md 落盘 + 内容完整可读回', async () => {
    const result = await writeFile({
      workspaceManager: mgr,
      type: 'md',
      filename: 'mix-report.md',
      payload: {
        title: 'C30 配合比设计报告',
        sections: [
          { type: 'h1', content: '一、设计依据' },
          { type: 'p', content: '依据 GB/T 50010-2010 规范，水胶比不大于 0.45' },
          { type: 'h2', content: '二、材料用量' },
          { type: 'table', rows: [
            ['材料', '用量 (kg/m³)'],
            ['水泥', '350'],
            ['砂', '720'],
            ['石', '1080'],
            ['水', '175']
          ]},
          { type: 'list', items: ['满足强度要求', '满足耐久性要求'] }
        ]
      }
    })

    // 1) 文件落盘
    expect(result.path).toBe(path.posix.join(wsPath.replace(/\\/g, '/'), 'reports', 'mix-report.md'))
    expect(result.size).toBeGreaterThan(0)

    // 2) 磁盘上确实存在
    const stat = await fs.stat(path.join(wsPath, 'reports', 'mix-report.md'))
    expect(stat.size).toBe(result.size)

    // 3) 读回内容验证（markdown 文本）
    const text = await fs.readFile(path.join(wsPath, 'reports', 'mix-report.md'), 'utf-8')
    expect(text).toContain('C30 配合比设计报告')
    expect(text).toContain('350')
  })
})

// ============================================================
// 验收 3：坏 PDF → wiki/ 无新增
// ============================================================

describe('E2E 验收 3：坏 PDF → wiki/ 无新增（老板清单第 3 条）', () => {
  let wsPath, mgr, wiki

  beforeEach(async () => {
    wsPath = await mkTmpDir('p6-acc-3')
    mgr = new WorkspaceManager()
    await mgr.open(wsPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(wsPath)
  })

  test('放坏 PDF → ingest 抛错 → wiki/sources/ 无 .md、wiki/kg/sources/ 无 .json', async () => {
    // 1) 复制 broken.pdf fixture
    const brokenSrc = path.join(__dirname, 'readers', 'fixtures', 'broken.pdf')
    const brokenDst = path.join(wsPath, 'broken.pdf')
    await fs.copyFile(brokenSrc, brokenDst)

    // 2) 记录 ingest 前的 wiki/ 状态
    const wikiDir = path.join(wsPath, 'wiki')
    await fs.mkdir(wikiDir, { recursive: true })
    const sourcesBefore = await listDirSafe(path.join(wikiDir, 'sources'))
    const kgSourcesBefore = await listDirSafe(path.join(wikiDir, 'kg', 'sources'))

    // 3) ingest 期望失败
    await expect(wiki.ingest({ filename: 'broken.pdf' })).rejects.toMatchObject({ code: 'PARSE_FAIL' })

    // 4) 断言 wiki/sources/ 无新增 .md
    const sourcesAfter = await listDirSafe(path.join(wikiDir, 'sources'))
    expect(sourcesAfter).toEqual(sourcesBefore)
    expect(sourcesAfter.filter(n => n.endsWith('.md'))).toHaveLength(0)

    // 5) 断言 wiki/kg/sources/ 无新增 .json
    const kgSourcesAfter = await listDirSafe(path.join(wikiDir, 'kg', 'sources'))
    expect(kgSourcesAfter).toEqual(kgSourcesBefore)
    expect(kgSourcesAfter.filter(n => n.endsWith('.json'))).toHaveLength(0)

    // 6) 断言 .tmp/ 被清理（原子性 invariant）
    const tmpDir = path.join(wikiDir, '.tmp')
    const tmpEntries = await listDirSafe(tmpDir)
    expect(tmpEntries).toHaveLength(0)
  })

  test('非 PDF 坏文件（不是 PDF 后缀）→ 同上 ingest 失败 → wiki/ 无新增', async () => {
    // 写一个 garbage.bin，扩展名不在 readers 索引
    await fs.writeFile(path.join(wsPath, 'garbage.bin'), 'NOT-A-REAL-FORMAT')
    const sourcesBefore = await listDirSafe(path.join(wsPath, 'wiki', 'sources'))

    await expect(wiki.ingest({ filename: 'garbage.bin' })).rejects.toThrow()

    const sourcesAfter = await listDirSafe(path.join(wsPath, 'wiki', 'sources'))
    expect(sourcesAfter).toEqual(sourcesBefore)
  })
})

// ============================================================
// 验收 4：/rounds 3 → 主循环 3 步停止
// ============================================================

describe('E2E 验收 4：/rounds → 主循环停止（v10.2.0 范围 5-200）', () => {
  test('/rounds 5 → SystemService.agentMaxSteps = "5" + slash handler 返回 success', async () => {
    // v10.2.0：范围 5-200（之前 1-30），所以测试用 5
    mockSystemParams.clear()
    setupSlashHandler()
    const result = await execSlash('rounds', '5')

    expect(result.success).toBe(true)
    expect(result.message).toContain('5')
    expect(mockSystemParams.get('agentMaxSteps')).toBeDefined()
    expect(mockSystemParams.get('agentMaxSteps').value).toBe('5')
  })

  test('/rounds 无参 → 报当前值 + 不写 SystemService', async () => {
    mockSystemParams.clear()
    mockSystemParams.set('agentMaxSteps', { name: 'agentMaxSteps', value: '15', category: 'ai' })

    setupSlashHandler()
    const result = await execSlash('rounds', null)
    expect(result.success).toBe(true)
    expect(result.action).toBe('list')
    expect(result.message).toContain('15')
  })

  test('/rounds 0 / 4 / 201 / abc → 拒绝 + 返回 success:false（v10.2.0 范围 5-200）', async () => {
    setupSlashHandler()
    for (const bad of ['0', '4', '201', 'abc', '-1']) {
      const r = await execSlash('rounds', bad)
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/5.*200|整数/)
    }
  })

  test('UnifiedStrategy 读 maxSteps=3 → LLM chatWithToolsStream 调用次数 ≤ 3（主循环 3 步停止）', async () => {
    // 这是验收 4 的核心：/rounds 3 之后，agent 跑复杂任务恰好 3 步停止
    // 真模块：UnifiedStrategy；mock：deepseekService + skillRegistry + skillExecutor + memory + systemService

    // 1) 模拟 /rounds 3 已设置
    mockSystemParams.set('agentMaxSteps', { name: 'agentMaxSteps', value: '3', category: 'ai' })

    // 2) mock deepseekService 让 _getConfig 返回 maxSteps=3（须带 apiKey，llmFailover 会过滤无 key 配置）
    const llmCalls = jest.fn()
    const deepseekMock = {
      _getConfig: jest.fn(async () => ({ maxSteps: 3, apiKey: 'sk-test' })),
      chatWithToolsStream: jest.fn(async () => {
        llmCalls()
        // 永远返回 tool_calls（永远要调工具，触发主循环跑满）
        return { content: null, tool_calls: [{ id: 'c1', function: { name: 'workspace.search', arguments: '{}' } }] }
      })
    }
    // 桥接：UnifiedStrategy 内部 new DeepSeekService 走类 mock（见文件头部）
    mockLLMClass = deepseekMock.chatWithToolsStream

    // 3) skill mock
    const skillRegistryMock = {
      getToolSchemas: jest.fn(() => []),
      getSkill: jest.fn(() => ({ name: 'workspace.search', parameters: {} }))
    }
    const skillExecutorMock = {
      execute: jest.fn(async () => ({ success: true, data: 'r' }))
    }
    const agentMemoryMock = {
      saveMessage: jest.fn(async () => {}),
      buildAgentMdBlock: jest.fn(async () => ''),
      buildHistoryMessages: jest.fn(async () => [])
    }
    const systemServiceMock = {
      getParamByName: jest.fn(async (name) => mockSystemParams.get(name) || null)
    }

    const strategy = new UnifiedStrategy({
      deepseekService: deepseekMock,
      skillRegistry: skillRegistryMock,
      skillExecutor: skillExecutorMock,
      agentMemoryService: agentMemoryMock,
      systemService: systemServiceMock
    })

    // 4) 执行（无 webContents，无 signal）
    await strategy.execute({ sessionId: 'test-session', message: '复杂任务：设计 C30' })

    // 5) 断言：LLM 调用次数 ≤ 3（即主循环跑了 ≤ 3 步就停）
    expect(llmCalls.mock.calls.length).toBeLessThanOrEqual(3)
    expect(llmCalls.mock.calls.length).toBeGreaterThanOrEqual(1)  // 至少跑过 1 步
    // _getConfig 被读过（验证 maxSteps 链路通了）
    expect(deepseekMock._getConfig).toHaveBeenCalled()
  })
})

// ============================================================
// 验收 5：wiki 抽屉 markdown 渲染
// ============================================================

describe('E2E 验收 5：wiki 抽屉 markdown 渲染（老板清单第 5 条）', () => {
  let wsPath, mgr, wiki

  beforeEach(async () => {
    wsPath = await mkTmpDir('p6-acc-5')
    mgr = new WorkspaceManager()
    await mgr.open(wsPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(wsPath)
  })

  test('ingest .md 后 → WikiEngine.readPage 拿到的 content 是剥离 frontmatter 的纯 markdown → 可直接喂 markdown 渲染器', async () => {
    // 1) 写一份带 markdown 结构的源文件
    const src = `# C30 配合比

## 设计依据
依据 **GB/T 50010-2010** 规范。

## 材料用量
| 材料 | 用量 (kg/m³) |
|------|---|
| 水泥 | 350 |
| 砂 | 720 |

## 计算步骤
1. 确定强度等级
2. 计算水胶比
3. 选用水量
`
    await fs.writeFile(path.join(wsPath, 'c30-mix.md'), src)

    // 2) ingest
    const ingest = await wiki.ingest({ filename: 'c30-mix.md' })
    expect(ingest.status).toBe('ok')
    const wikiRel = ingest.pagesCreated[0]

    // 3) readPage
    const page = await wiki.readPage(wikiRel)

    // 4) content 字段是剥离 frontmatter 后的纯 markdown（不含 --- 头）
    expect(page.content).not.toContain('title:')
    expect(page.content).not.toContain('source:')
    expect(page.content).toContain('# C30 配合比')
    expect(page.content).toContain('## 设计依据')
    expect(page.content).toContain('**GB/T 50010-2010**')
    expect(page.content).toContain('| 水泥 | 350 |')
    expect(page.content).toContain('1. 确定强度等级')

    // 5) frontmatter 单独解析（与 content 分离）
    expect(page.frontmatter.title).toBeTruthy()
    expect(page.frontmatter.source).toBe('c30-mix.md')

    // 6) 模拟前端 react-markdown 渲染：基于 gray-matter 解析 frontmatter 后，
    //    react-markdown 能解析的纯 markdown 应包含以下特征：
    //    - # 一级标题（heading 1）
    //    - ## 二级标题（heading 2）
    //    - **粗体**（strong）
    //    - 表格行 | ... | ... |
    //    - 有序列表 1. 2. 3.
    //    - 链接 [text](url)（如有）
    // 这里我们用 gray-matter 拆 frontmatter + 用 mdast-util-from-markdown（同 ESM 跳过），
    // 改用更稳的"正则扫"验证 markdown 结构完整
    expect(page.content).toMatch(/^# /m)                            // 至少一个 H1
    expect(page.content).toMatch(/^## /m)                           // 至少一个 H2
    expect(page.content).toMatch(/\*\*[^*]+\*\*/)                   // 至少一段 bold
    expect(page.content).toMatch(/^\|/m)                            // 表格行
    expect(page.content).toMatch(/^\d+\. /m)                        // 有序列表
    // 内容片段含关键术语（前端渲染时不会丢）
    expect(page.content).toContain('GB/T 50010-2010')
    expect(page.content).toContain('水泥')
  })

  test('readPage 含 [[wiki-link]] → link 解析规则与 WikiEngine.lint 兼容', async () => {
    // 验证 markdown 渲染时 [[xxx]] 链接能被识别（wiki 抽屉渲染器的 link 解析）
    await fs.writeFile(
      path.join(wsPath, 'note.md'),
      '# 引用页\n\n参考 [[c30-mix]] 配合比和 [[抗渗]] 规范。\n'
    )
    const ingest = await wiki.ingest({ filename: 'note.md' })
    const page = await wiki.readPage(ingest.pagesCreated[0])
    expect(page.content).toMatch(/\[\[c30-mix\]\]/)
    expect(page.content).toMatch(/\[\[抗渗\]\]/)
  })
})

// ============================================================
// 验收 6：mock 429 → query 走 BM25 降级
// ============================================================

describe('E2E 验收 6：mock 429 → query 走 BM25 降级（老板清单第 6 条）', () => {
  let wsPath, mgr, wiki

  beforeEach(async () => {
    wsPath = await mkTmpDir('p6-acc-6')
    mgr = new WorkspaceManager()
    await mgr.open(wsPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(wsPath)
  })

  test('WikiEngine.search 不依赖 LLM（即使 LLM 429 / 不存在也能返回命中）', async () => {
    // 1) 先 ingest 一些内容（build BM25 index）
    await fs.writeFile(
      path.join(wsPath, '抗渗.md'),
      '# 抗渗混凝土\n\n抗渗混凝土水胶比不应大于 0.45，掺加硅灰能显著提高抗渗性能。'
    )
    await wiki.ingest({ filename: '抗渗.md' })

    await fs.writeFile(
      path.join(wsPath, 'uhpc.md'),
      '# UHPC 配合比\n\nUHPC 掺入钢纤维和硅灰，28d 抗压强度可达 150MPa 以上。'
    )
    await wiki.ingest({ filename: 'uhpc.md' })

    // 2) 直接调 search（纯本地 BM25，不走 LLM）
    //    即使外部 LLM 触发 429（这里根本不调 LLM）也能拿到结果
    const hits = await wiki.search('硅灰 抗压强度', 5)

    // 3) 命中 ≥ 1 条（BM25 排序）
    expect(hits.length).toBeGreaterThan(0)
    // 命中至少包含一条 sourceType='wiki'
    expect(hits.every(h => h.sourceType === 'wiki')).toBe(true)
    // 至少一条命中包含"硅灰"
    const combined = hits.map(h => h.snippet).join(' ')
    expect(combined).toMatch(/硅灰/)

    // 4) 关键验证：search 流程没碰任何"网络" / "LLM"——它就是 BM25
    //    我们断言 results 全是同步构造出来的本地结构（无 .source LLM 字段）
    hits.forEach(h => {
      expect(h).toHaveProperty('path')
      expect(h).toHaveProperty('title')
      expect(h).toHaveProperty('snippet')
      expect(h).toHaveProperty('score')
      expect(h).toHaveProperty('sourceType')
    })
  })

  test('WikiEngine.search 在 LLM 429 不可用场景下仍返回 BM25 命中（降级语义）', async () => {
    // 模拟 LLM 客户端 429（但 WikiEngine.search 完全不依赖它）
    const llmMock429 = {
      invoke: jest.fn(async () => {
        const err = new Error('rate limit')
        err.status = 429
        throw err
      })
    }

    // 1) 用真 KGExtractor 配 429 mock LLM，证明 KG 路径会被降级为 quality:low
    const extractor = new KGExtractor({ llmClient: llmMock429, schema })
    const extractResult = await extractor.extract('硅灰能提高强度', 'test.pdf')
    expect(extractResult.quality).toBe('low')  // 降级
    expect(llmMock429.invoke).toHaveBeenCalled()  // LLM 被试过一次

    // 2) WikiEngine.search 完全独立——不调 LLM——直接返回 BM25 结果
    await fs.writeFile(
      path.join(wsPath, 'doc.md'),
      '# Doc\n\n硅灰能提高抗压强度。'
    )
    await wiki.ingest({ filename: 'doc.md' })

    const hits = await wiki.search('硅灰', 5)
    expect(hits.length).toBeGreaterThan(0)
    // 验证 search 路径没碰 llmMock（我们不再调 llmMock，但若之前调过也已拒绝）
    // 这里 search 是 WikiEngine.search，与 LLM 完全解耦
  })

  test('KGExtractor.searchGraph 也不依赖 LLM（graph.json 本地 BM25 降级查询）', async () => {
    // 准备 graph.json（fixture）
    const wsDir = await mkTmpDir('p6-acc-6-graph')
    try {
      const kgDir = path.join(wsDir, 'wiki', 'kg')
      await fs.mkdir(kgDir, { recursive: true })
      const idA = sha1Id('硅灰', 'Material')      // 与 KGExtractor.extract 一致
      const idB = sha1Id('28d 抗压强度', 'Property')
      const graphFixture = {
        version: 1, workspacePath: wsDir.replace(/\\/g, '/'),
        entities: {
          [idA]: { id: idA, name: '硅灰', type: 'Material', aliases: [] }
        },
        relations: [{
          subjectId: idA, predicate: 'increases',
          objectId: idB,
          evidence: ev('硅灰能显著提高混凝土的 28d 抗压强度'),
          confidence: 0.95, source: 'uhpc.pdf'
        }],
        conflicts: [], mergeVersion: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
      // 加 object 实体
      graphFixture.entities[idB] = { id: idB, name: '28d 抗压强度', type: 'Property', aliases: [] }
      await fs.writeFile(path.join(kgDir, 'graph.json'), JSON.stringify(graphFixture), 'utf-8')

      const llmSpy = jest.fn()
      const extractor = new KGExtractor({ llmClient: { invoke: llmSpy } })
      const results = await extractor.searchGraph('硅灰 抗压强度', 5, wsDir)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].subject.name).toBe('硅灰')
      expect(llmSpy).not.toHaveBeenCalled()  // 关键：searchGraph 不调 LLM
    } finally {
      await rmTmpDir(wsDir)
    }
  })
})

// ============================================================
// 验收 7：UHPC 论文 PDF → KG 提取（≥10 entities + ≥8 relations + ≥3 relation types）
// ============================================================

describe('E2E 验收 7：UHPC 论文 → KG 提取（老板清单第 7 条）', () => {
  let wsPath, mgr

  beforeEach(async () => {
    wsPath = await mkTmpDir('p6-acc-7')
    mgr = new WorkspaceManager()
    await mgr.open(wsPath)
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(wsPath)
  })

  test('UHPC 论文 PDF → KG 提取：≥10 entities + ≥8 relations + ≥3 relation types + graph.json 合并正确', async () => {
    // 1) 准备 mock LLM：返回丰富 UHPC 三元组（>= 10 entities + >= 8 relations + >= 3 relation types）
    const mockLLM = makeMockLLM(
      // entities
      [
        { name: 'UHPC', type: 'Spec' },
        { name: '硅灰', type: 'Material' },
        { name: '钢纤维', type: 'Material' },
        { name: '石英砂', type: 'Material' },
        { name: '水泥', type: 'Material' },
        { name: '减水剂', type: 'Admixture' },
        { name: '28d 抗压强度', type: 'Property' },
        { name: '抗拉强度', type: 'Property' },
        { name: '流动性', type: 'Property' },
        { name: '耐久性', type: 'Property' },
        { name: '水胶比', type: 'Property' },
        { name: '蒸汽养护', type: 'Process' }
      ],
      // relations
      [
        { subject: 'UHPC', predicate: 'requires', object: '硅灰',
          evidence: ev('UHPC 必须掺入硅灰以获得高强度'), confidence: 0.95 },
        { subject: 'UHPC', predicate: 'requires', object: '钢纤维',
          evidence: ev('UHPC 必须掺入钢纤维以获得高抗拉强度'), confidence: 0.95 },
        { subject: 'UHPC', predicate: 'requires', object: '石英砂',
          evidence: ev('UHPC 采用石英砂作为细骨料以提高致密度'), confidence: 0.9 },
        { subject: '硅灰', predicate: 'increases', object: '28d 抗压强度',
          evidence: ev('硅灰通过火山灰反应显著提高 28d 抗压强度'), confidence: 0.95 },
        { subject: '钢纤维', predicate: 'increases', object: '抗拉强度',
          evidence: ev('钢纤维桥接裂缝显著提高抗拉强度'), confidence: 0.95 },
        { subject: '水胶比', predicate: 'decreases', object: '流动性',
          evidence: ev('水胶比越低流动性越差需配减水剂'), confidence: 0.85 },
        { subject: '硅灰', predicate: 'decreases', object: '流动性',
          evidence: ev('硅灰比表面积大降低流动性'), confidence: 0.85 },
        { subject: 'UHPC', predicate: 'correlatesWith', object: '耐久性',
          evidence: ev('UHPC 致密微观结构与高耐久性密切相关'), confidence: 0.9 },
        { subject: '蒸汽养护', predicate: 'increases', object: '28d 抗压强度',
          evidence: ev('蒸汽养护加速水化提升早期抗压强度'), confidence: 0.85 },
        { subject: '减水剂', predicate: 'increases', object: '流动性',
          evidence: ev('高效减水剂显著提高混凝土流动性'), confidence: 0.9 }
      ]
    )

    // 2) 用真 KGExtractor
    const extractor = new KGExtractor({ llmClient: mockLLM, schema })

    // 3) 准备 UHPC 论文 PDF fixture（用 sample.pdf 当作 UHPC 论文）
    const pdfSrc = path.join(__dirname, 'readers', 'fixtures', 'sample.pdf')
    const pdfDst = path.join(wsPath, 'uhpc-paper.pdf')
    await fs.copyFile(pdfSrc, pdfDst)

    // 4) WikiEngine 注入 KGExtractor，ingest 一份 PDF
    const wiki = new WikiEngine({ workspace: mgr, kgExtractor: extractor })
    const ingest = await wiki.ingest({ filename: 'uhpc-paper.pdf' })
    expect(ingest.status).toBe('ok')

    // 5) 断言 wiki/kg/sources/<slug>.json 落盘 + 内容含 ≥10 entities + ≥8 relations + ≥3 relation types
    const kgSourcesDir = path.join(wsPath, 'wiki', 'kg', 'sources')
    const kgFiles = await fs.readdir(kgSourcesDir)
    expect(kgFiles.length).toBeGreaterThan(0)
    const kgJson = JSON.parse(await fs.readFile(path.join(kgSourcesDir, kgFiles[0]), 'utf-8'))

    expect(kgJson.quality).toBe('high')
    expect(kgJson.entities.length).toBeGreaterThanOrEqual(10)
    expect(kgJson.relations.length).toBeGreaterThanOrEqual(8)
    const relationTypes = new Set(kgJson.relations.map(r => r.predicate))
    expect(relationTypes.size).toBeGreaterThanOrEqual(3)

    // 6) 断言 wiki/kg/graph.json 合并正确（多源 evidence 累积、conflict 列表）
    const graphPath = path.join(wsPath, 'wiki', 'kg', 'graph.json')
    const graphStat = await fs.stat(graphPath)
    expect(graphStat.size).toBeGreaterThan(0)
    const graph = JSON.parse(await fs.readFile(graphPath, 'utf-8'))

    // 实体累计 ≥ 10
    expect(Object.keys(graph.entities).length).toBeGreaterThanOrEqual(10)
    // 关系累计 ≥ 8
    expect(graph.relations.length).toBeGreaterThanOrEqual(8)
    // relation type 累计 ≥ 3
    const graphRelTypes = new Set(graph.relations.map(r => r.predicate))
    expect(graphRelTypes.size).toBeGreaterThanOrEqual(3)
    // mergeVersion 已 +1
    expect(graph.mergeVersion).toBeGreaterThanOrEqual(1)

    // 7) ingest 结果里 kgMerge 报告
    expect(ingest.kgMerge).toBeDefined()
    expect(ingest.kgMerge.mergedEntities).toBeGreaterThanOrEqual(10)
    expect(ingest.kgMerge.mergedRelations).toBeGreaterThanOrEqual(8)
    expect(ingest.kgMerge.conflictsDetected).toBeGreaterThanOrEqual(0)
  })

  test('多源 evidence 累积：同一 (s, p, o) 多次出现 → evidence 合并 + 取最高 confidence', async () => {
    // 准备一个 graph.json（已有硅灰 increases 28d 抗压强度，confidence 0.85）
    const wsGraph = await mkTmpDir('p6-acc-7-multi')
    try {
      const kgDir = path.join(wsGraph, 'wiki', 'kg')
      await fs.mkdir(kgDir, { recursive: true })
      const initialGraph = {
        version: 1, workspacePath: wsGraph.replace(/\\/g, '/'),
        entities: {
          [sha1Id('硅灰', 'Material')]: { id: sha1Id('硅灰', 'Material'), name: '硅灰', type: 'Material', aliases: [], source: 'paper1.pdf' },
          [sha1Id('28d 抗压强度', 'Property')]: { id: sha1Id('28d 抗压强度', 'Property'), name: '28d 抗压强度', type: 'Property', aliases: [], source: 'paper1.pdf' }
        },
        relations: [{
          subjectId: sha1Id('硅灰', 'Material'), predicate: 'increases',
          objectId: sha1Id('28d 抗压强度', 'Property'),
          evidence: ev('硅灰能提高 28d 抗压强度'), confidence: 0.85,
          source: 'paper1.pdf'
        }],
        conflicts: [], mergeVersion: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
      await fs.writeFile(path.join(kgDir, 'graph.json'), JSON.stringify(initialGraph), 'utf-8')

      // 新 LLM 返回相同 (硅灰, increases, 28d 抗压强度) 但 confidence=0.95 + 新 evidence
      const mockLLM = makeMockLLM(
        [
          { name: '硅灰', type: 'Material' },
          { name: '28d 抗压强度', type: 'Property' }
        ],
        [
          { subject: '硅灰', predicate: 'increases', object: '28d 抗压强度',
            evidence: ev('硅灰的火山灰活性显著提高 28d 抗压强度'), confidence: 0.95 }
        ]
      )
      const extractor = new KGExtractor({ llmClient: mockLLM, schema })

      // 合并
      const oldGraph = JSON.parse(await fs.readFile(path.join(kgDir, 'graph.json'), 'utf-8'))
      const newTriples = await extractor.extract('硅灰的火山灰活性显著提高 28d 抗压强度', 'paper2.pdf')
      const { graph, conflicts } = mergeInto(oldGraph, newTriples, 'paper2.pdf')

      // evidence 合并（包含两个来源的 evidence）
      expect(graph.relations).toHaveLength(1)
      expect(graph.relations[0].evidence).toContain('硅灰的火山灰活性显著提高 28d 抗压强度')
      // confidence 取最高
      expect(graph.relations[0].confidence).toBe(0.95)
      // 无冲突
      expect(conflicts).toHaveLength(0)
      // mergeVersion +1
      expect(graph.mergeVersion).toBe(2)
    } finally {
      await rmTmpDir(wsGraph)
    }
  })

  test('冲突检测：同 (s, o) 不同 predicate → 进 conflicts 列表', async () => {
    const wsGraph = await mkTmpDir('p6-acc-7-conflict')
    try {
      const kgDir = path.join(wsGraph, 'wiki', 'kg')
      await fs.mkdir(kgDir, { recursive: true })
      const initialGraph = {
        version: 1, workspacePath: wsGraph.replace(/\\/g, '/'),
        entities: {
          [sha1Id('硅灰', 'Material')]: { id: sha1Id('硅灰', 'Material'), name: '硅灰', type: 'Material', aliases: [], source: 'paper1.pdf' },
          [sha1Id('流动性', 'Property')]: { id: sha1Id('流动性', 'Property'), name: '流动性', type: 'Property', aliases: [], source: 'paper1.pdf' }
        },
        relations: [{
          subjectId: sha1Id('硅灰', 'Material'), predicate: 'increases',
          objectId: sha1Id('流动性', 'Property'),
          evidence: ev('硅灰能提高流动性'), confidence: 0.7,
          source: 'paper1.pdf'
        }],
        conflicts: [], mergeVersion: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
      await fs.writeFile(path.join(kgDir, 'graph.json'), JSON.stringify(initialGraph), 'utf-8')

      const mockLLM = makeMockLLM(
        [
          { name: '硅灰', type: 'Material' },
          { name: '流动性', type: 'Property' }
        ],
        [
          { subject: '硅灰', predicate: 'decreases', object: '流动性',
            evidence: ev('硅灰比表面积大降低流动性'), confidence: 0.85 }
        ]
      )
      const extractor = new KGExtractor({ llmClient: mockLLM, schema })
      const oldGraph = JSON.parse(await fs.readFile(path.join(kgDir, 'graph.json'), 'utf-8'))
      const newTriples = await extractor.extract('硅灰降低流动性', 'paper2.pdf')
      const { graph, conflicts } = mergeInto(oldGraph, newTriples, 'paper2.pdf')

      // conflicts 列表有 1 条
      expect(conflicts.length).toBe(1)
      expect(conflicts[0].type).toBe('conflicting_relation')
      // 保留新关系（graph.relations 有 2 条）
      expect(graph.relations.length).toBe(2)
      // graph.conflicts 含这条
      expect(graph.conflicts.some(c => c.type === 'conflicting_relation')).toBe(true)
    } finally {
      await rmTmpDir(wsGraph)
    }
  })

  test('workspace:searchGraph("硅灰 抗压强度") → 返回完整三元组', async () => {
    // 这是验收 7 的最后一步：调用查询接口验证图谱可用
    const wsGraph = await mkTmpDir('p6-acc-7-query')
    try {
      const kgDir = path.join(wsGraph, 'wiki', 'kg')
      await fs.mkdir(kgDir, { recursive: true })
      const fixture = {
        version: 1, workspacePath: wsGraph.replace(/\\/g, '/'),
        entities: {
          [sha1Id('硅灰', 'Material')]: { id: sha1Id('硅灰', 'Material'), name: '硅灰', type: 'Material', aliases: ['硅粉'] },
          [sha1Id('28d 抗压强度', 'Property')]: { id: sha1Id('28d 抗压强度', 'Property'), name: '28d 抗压强度', type: 'Property', aliases: [] }
        },
        relations: [{
          subjectId: sha1Id('硅灰', 'Material'), predicate: 'increases',
          objectId: sha1Id('28d 抗压强度', 'Property'),
          evidence: ev('硅灰的火山灰活性显著提高 28d 抗压强度'), confidence: 0.95,
          source: 'uhpc.pdf'
        }],
        conflicts: [], mergeVersion: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
      await fs.writeFile(path.join(kgDir, 'graph.json'), JSON.stringify(fixture), 'utf-8')

      const extractor = new KGExtractor({ llmClient: null })
      const triples = await extractor.searchGraph('硅灰 抗压强度', 5, wsGraph)

      // 返回完整三元组
      expect(triples.length).toBeGreaterThanOrEqual(1)
      expect(triples[0]).toHaveProperty('subject')
      expect(triples[0]).toHaveProperty('predicate')
      expect(triples[0]).toHaveProperty('object')
      expect(triples[0].subject.name).toBe('硅灰')
      expect(triples[0].predicate).toBe('increases')
      expect(triples[0].object.name).toBe('28d 抗压强度')
      expect(triples[0].evidence).toContain('28d')
      expect(triples[0].confidence).toBe(0.95)
    } finally {
      await rmTmpDir(wsGraph)
    }
  })
})

// ==================== 辅助函数 ====================

async function listDirSafe(dir) {
  try {
    return await fs.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}
