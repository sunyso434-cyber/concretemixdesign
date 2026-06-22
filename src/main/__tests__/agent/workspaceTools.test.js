// workspaceTools.test.js（Task 4.1）
// 测试 7 个 workspace 伪 Skill：
//   1) buildWorkspaceSkills 返回 7 个 skill，名称集合正确
//   2) 每个 skill 都有 execute + services=[]
//   3) 每个 invoke 正确转发到对应依赖（wikiEngine / workspaceManager / writeHandler / kgExtractor）
//   4) searchGraph 在 kgExtractor=null 时抛 WorkspaceError(NOT_OPEN)，被 execute 包成 {success:false, errorCode:'NOT_OPEN'}
//   5) 普通 Error → execute 包成 UNKNOWN
//   6) SkillRegistry.register 能成功注册（验证 4 字段协议：name/description/parameters/execute）

const { buildWorkspaceSkills } = require('../../agent/workspaceTools')
const { WorkspaceError } = require('../../workspace/WorkspaceError')
const ErrorCodes = require('../../agent/ErrorCodes')

function makeMockWiki() {
  return {
    search: jest.fn().mockResolvedValue([{ path: 'sources/a.md', score: 1.0 }]),
    readPage: jest.fn().mockResolvedValue({ content: 'body', frontmatter: {}, mtime: 0, size: 4 }),
    ingest: jest.fn().mockResolvedValue({ status: 'ok', pagesCreated: ['sources/x.md'] }),
    lint: jest.fn().mockResolvedValue({ missingFrontmatter: [], orphans: [], missingCrossRefs: [], staleSummaries: [], contradictions: [] })
  }
}

function makeMockWM() {
  return {
    listFiles: jest.fn().mockResolvedValue([{ name: 'a.md', path: 'root/a.md', size: 0 }]),
    current: () => null  // 默认工作区未开；具体测试需要时可覆盖
  }
}

function makeMockKG() {
  return {
    searchGraph: jest.fn().mockResolvedValue({ triples: [{ s: 'a', p: 'b', o: 'c' }] })
  }
}

describe('buildWorkspaceSkills（Task 4.1 - 7 个伪 Skill）', () => {
  test('返回 7 个伪 Skill，名称集合与 brief 一致', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    expect(skills).toHaveLength(7)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual([
      'workspace_ingest', 'workspace_lint', 'workspace_listFiles',
      'workspace_readPage', 'workspace_search', 'workspace_searchGraph', 'workspace_writeFile'
    ].sort())
  })

  test('每个 skill 都有 execute 函数 + services=[]（伪 Skill 不依赖业务服务）', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    for (const s of skills) {
      expect(typeof s.execute).toBe('function')
      expect(s.services).toEqual([])
      expect(s.category).toBe('workspace')
    }
  })

  test('每个 skill 有 name/description/parameters（SkillRegistry 注册要求 4 字段）', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    for (const s of skills) {
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(typeof s.description).toBe('string')
      expect(s.description.length).toBeGreaterThan(0)
      expect(typeof s.parameters).toBe('object')
    }
  })

  // ===== invoke 转发测试 =====

  test('workspace_search → wikiEngine.search(query, topK)', async () => {
    const wiki = makeMockWiki()
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_search')
    const result = await skill.execute({ query: '硅灰', topK: 3 }, {})
    expect(wiki.search).toHaveBeenCalledWith('硅灰', 3)
    expect(result).toEqual([{ path: 'sources/a.md', score: 1.0 }])
  })

  test('workspace_search 不传 topK → 默认 5', async () => {
    const wiki = makeMockWiki()
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_search')
    await skill.execute({ query: '粉煤灰' }, {})
    expect(wiki.search).toHaveBeenCalledWith('粉煤灰', 5)
  })

  test('workspace_readPage → wikiEngine.readPage(wikiPath)', async () => {
    const wiki = makeMockWiki()
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_readPage')
    const result = await skill.execute({ wikiPath: 'sources/jgj-55-2011.md' }, {})
    expect(wiki.readPage).toHaveBeenCalledWith('sources/jgj-55-2011.md')
    expect(result.content).toBe('body')
  })

  test('workspace_ingest → wikiEngine.ingest(args)', async () => {
    const wiki = makeMockWiki()
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_ingest')
    const result = await skill.execute({ filename: 'report.pdf' }, {})
    expect(wiki.ingest).toHaveBeenCalledWith({ filename: 'report.pdf' })
    expect(result.status).toBe('ok')
  })

  test('workspace_lint → wikiEngine.lint()（无参）', async () => {
    const wiki = makeMockWiki()
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_lint')
    const result = await skill.execute({}, {})
    expect(wiki.lint).toHaveBeenCalledWith()
    expect(result.missingFrontmatter).toEqual([])
    expect(result.contradictions).toEqual([])
  })

  test('workspace_listFiles → workspaceManager.listFiles(subdir, options) 并包成 {files}', async () => {
    const wm = makeMockWM()
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: makeMockWiki(), kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_listFiles')
    const result = await skill.execute({ subdir: 'reports' }, {})
    // v2026-06-22：listFiles 加 options 参数（recursive/includeDirs/withIngestStatus）
    expect(wm.listFiles).toHaveBeenCalledWith('reports', {
      recursive: undefined, includeDirs: undefined, withIngestStatus: undefined
    })
    expect(result).toEqual({ files: [{ name: 'a.md', path: 'root/a.md', size: 0 }] })
  })

  test('workspace_searchGraph 在 kgExtractor=null 时抛 WorkspaceError(NOT_OPEN) → 包成 ErrorCodes 格式', async () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    const skill = skills.find(s => s.name === 'workspace_searchGraph')
    const result = await skill.execute({ query: '硅灰' }, {})
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('NOT_OPEN')
    expect(result.error).toContain('知识图谱未启用')
  })

  test('workspace_searchGraph 在 kgExtractor 存在时 → kgExtractor.searchGraph(query, topK, workspacePath)', async () => {
    const kg = makeMockKG()
    // v8.0.4 后 invoke 自动从 workspaceManager.current().path 拿 workspacePath
    const wmWithPath = {
      ...makeMockWM(),
      current: () => ({ path: '/test-workspace' })
    }
    const skills = buildWorkspaceSkills({
      workspaceManager: wmWithPath,
      wikiEngine: makeMockWiki(),
      kgExtractor: kg
    })
    const skill = skills.find(s => s.name === 'workspace_searchGraph')
    const result = await skill.execute({ query: '硅灰', topK: 8 }, {})
    expect(kg.searchGraph).toHaveBeenCalledWith('硅灰', 8, '/test-workspace')
    expect(result).toEqual({ triples: [{ s: 'a', p: 'b', o: 'c' }] })
  })

  // ===== 错误传播测试 =====

  test('invoke 抛 WorkspaceError → execute 转 ErrorCodes 格式（成功透传 code）', async () => {
    const wiki = {
      ...makeMockWiki(),
      search: jest.fn().mockRejectedValue(new WorkspaceError('PAGE_NOT_FOUND', 'wiki 页不存在: x.md', false))
    }
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_search')
    const result = await skill.execute({ query: 'x' }, {})
    expect(result).toMatchObject({
      success: false,
      errorCode: 'PAGE_NOT_FOUND',
      error: 'wiki 页不存在: x.md'
    })
  })

  test('invoke 抛普通 Error → execute 包成 UNKNOWN（含 stack）', async () => {
    const wiki = {
      ...makeMockWiki(),
      search: jest.fn().mockRejectedValue(new Error('boom'))
    }
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_search')
    const result = await skill.execute({ query: 'x' }, {})
    expect(result).toMatchObject({
      success: false,
      errorCode: ErrorCodes.UNKNOWN,
      error: 'boom'
    })
    expect(result.details && result.details.stack).toContain('boom')
  })

  // ===== 集成：SkillRegistry.register 能成功 =====

  test('所有 7 个伪 Skill 能被 SkillRegistry.register 接受（验证 4 字段协议）', () => {
    const SkillRegistry = require('../../agent/SkillRegistry')
    const reg = new SkillRegistry()
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    for (const s of skills) {
      // 不抛错即通过（register 内部 _validateSkill 检查 name/description/execute）
      reg.register(s, { builtin: true, filePath: '<workspace-pseudo>' })
    }
    expect(reg.size).toBe(7)
    // getToolSchemas 包含这 7 个
    const schemas = reg.getToolSchemas()
    const names = schemas.map(sc => sc.function.name).sort()
    expect(names).toEqual([
      'workspace_ingest', 'workspace_lint', 'workspace_listFiles',
      'workspace_readPage', 'workspace_search', 'workspace_searchGraph', 'workspace_writeFile'
    ].sort())
  })
})

// v8.0.3 hotfix：workspace_writeFile 的 description 必须包含完整 payload schema
// 防止 LLM 不知道 payload 结构只传 { title } → 只生成标题没正文
describe('buildWorkspaceSkills v8.0.3 hotfix：workspace_writeFile payload schema 提示（防回归）', () => {
  test('workspace_writeFile description 必须包含 "payload" 关键词', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    const writeFile = skills.find(s => s.name === 'workspace_writeFile')
    expect(writeFile.description).toContain('payload')
  })

  test('workspace_writeFile description 必须包含 "sections" 关键词', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    const writeFile = skills.find(s => s.name === 'workspace_writeFile')
    expect(writeFile.description).toContain('sections')
  })

  test('workspace_writeFile description 必须包含所有 6 种 section type（h1/h2/p/list/table/code）', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    const writeFile = skills.find(s => s.name === 'workspace_writeFile')
    for (const type of ['h1', 'h2', 'p', 'list', 'table', 'code']) {
      expect(writeFile.description).toContain(type)
    }
  })

  test('workspace_writeFile description 必须提示 payload 必须包含 sections', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    const writeFile = skills.find(s => s.name === 'workspace_writeFile')
    // 必须有明确指引让 LLM 知道 sections 不可省
    expect(writeFile.description).toMatch(/payload.*sections|sections.*payload|必须包含/)
  })
})

// v8.0.4 hotfix：workspace_searchGraph invoke 必须自动传 workspacePath 给 KGExtractor
// 防止 LLM 漏传 workspacePath → KGExtractor 抛 PATH_INVALID
describe('buildWorkspaceSkills v8.0.4 hotfix：workspace_searchGraph workspacePath 自动注入（防回归）', () => {
  test('workspace_searchGraph invoke 传给 KGExtractor 的 workspacePath = global.workspaceManager.current().path', async () => {
    // mock KGExtractor 接收并验证参数
    let capturedArgs = null
    const mockKG = {
      searchGraph: jest.fn().mockImplementation(async (query, topK, workspacePath) => {
        capturedArgs = { query, topK, workspacePath }
        return { triples: [{ s: 'a', p: 'b', o: 'c' }] }
      })
    }
    const mockWM = {
      current: () => ({ path: 'D:/test-workspace' })
    }

    // 用 mock KG 构造 skill
    const skills = buildWorkspaceSkills({
      workspaceManager: mockWM,
      wikiEngine: makeMockWiki(),
      kgExtractor: mockKG
    })
    const searchGraph = skills.find(s => s.name === 'workspace_searchGraph')

    // LLM 只传 { query, topK }（v8.0.3 的真实场景）
    await searchGraph.execute({ query: 'UHPC', topK: 10 }, {})

    // workspacePath 应自动从 mockWM 拿
    expect(capturedArgs.workspacePath).toBe('D:/test-workspace')
    expect(capturedArgs.query).toBe('UHPC')
    expect(capturedArgs.topK).toBe(10)
  })

  test('workspace_searchGraph 工作区未开时返回友好错误（NOT_OPEN），不抛 PATH_INVALID', async () => {
    const mockKG = {
      searchGraph: jest.fn().mockResolvedValue({ triples: [] })
    }
    const mockWMClosed = {
      current: () => null
    }
    const skills = buildWorkspaceSkills({
      workspaceManager: mockWMClosed,
      wikiEngine: makeMockWiki(),
      kgExtractor: mockKG
    })
    const searchGraph = skills.find(s => s.name === 'workspace_searchGraph')

    const result = await searchGraph.execute({ query: 'UHPC', topK: 10 }, {})
    // 应该返回 WorkspaceError(NOT_OPEN)，不调 KGExtractor
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('NOT_OPEN')
    expect(result.error).toContain('请先打开工作区')
    expect(mockKG.searchGraph).not.toHaveBeenCalled()
  })

  test('workspace_searchGraph description 必须说明前提（工作区已打开 + LLM 不传 workspacePath）', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    const searchGraph = skills.find(s => s.name === 'workspace_searchGraph')
    expect(searchGraph.description).toContain('当前工作区')
    expect(searchGraph.description).toContain('LLM 不需要传')
  })
})