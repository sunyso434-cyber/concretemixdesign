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
    listFiles: jest.fn().mockResolvedValue([{ name: 'a.md', path: 'root/a.md', size: 0 }])
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

  test('workspace_listFiles → workspaceManager.listFiles(subdir) 并包成 {files}', async () => {
    const wm = makeMockWM()
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: makeMockWiki(), kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_listFiles')
    const result = await skill.execute({ subdir: 'reports' }, {})
    expect(wm.listFiles).toHaveBeenCalledWith('reports')
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

  test('workspace_searchGraph 在 kgExtractor 存在时 → kgExtractor.searchGraph(query, topK)', async () => {
    const kg = makeMockKG()
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: kg
    })
    const skill = skills.find(s => s.name === 'workspace_searchGraph')
    const result = await skill.execute({ query: '硅灰', topK: 8 }, {})
    expect(kg.searchGraph).toHaveBeenCalledWith('硅灰', 8)
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