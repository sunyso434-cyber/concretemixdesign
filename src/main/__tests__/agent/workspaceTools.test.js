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

// ponytail: 避免 fs mock 干扰 babel 模块解析，不用 jest.spyOn(fs)
// 改为在 beforeEach 中直接 monkey-patch fs.existsSync
const _fs = require('fs')
const _origExistsSync = _fs.existsSync
function _mockFsExistsSync(val) { _fs.existsSync = jest.fn().mockReturnValue(val) }
function _restoreFsExistsSync() { _fs.existsSync = _origExistsSync }

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
test('返回 26 个伪 Skill，名称集合与 brief 一致（2026-08-23 更新：v0.3.x 起 office/归档/分析系工具并入）', () => {
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    expect(skills).toHaveLength(26)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual([
      'workspace_grep', 'workspace_ingest', 'workspace_lint', 'workspace_listFiles',
      'workspace_readPage', 'workspace_search', 'workspace_searchGraph', 'workspace_writeFile',
      'workspace_readRaw', 'workspace_organize', 'workspace_recordAnswer',
      'workspace_analyze', 'workspace_mkdir', 'workspace_archiveReports',
      'read_office_file', 'edit_office_file', 'batch_office_edit',
      'query_office_elements', 'refresh_office_doc',
      'create_office_file', 'merge_office_template',
      'move_office_element', 'validate_office_file',
      'import_office_csv', 'officecli_raw', 'officecli_help'
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

  test('workspace_readPage → wikiEngine.readPage(wikiPath, {query, depth})', async () => {
    const wiki = makeMockWiki()
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_readPage')
    const result = await skill.execute({ wikiPath: 'sources/jgj-55-2011.md' }, {})
    // v1 改造：readPage 现在接受 {query, contextLines, depth} 第二参数
    expect(wiki.readPage).toHaveBeenCalledWith('sources/jgj-55-2011.md', {
      query: undefined, contextLines: undefined, depth: undefined
    })
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

  // v9.1.0 修复：图片走 imageIngest OCR 分支，不再抛 Unsupported file type
  test('workspace_ingest 收到 png 文件 → 走 imageIngest 分支', async () => {
    const wiki = makeMockWiki()
    const wm = {
      ...makeMockWM(),
      current: () => ({ path: '/test-workspace' }),
      _ingestImageAsync: jest.fn().mockResolvedValue({
        ocrText: '混凝土配合比',
        description: 'C30配合比表',
        imagePath: '/test-workspace/photo.png'
      })
    }
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_ingest')
    const result = await skill.execute({ filename: 'photo.png' }, {})
    expect(wm._ingestImageAsync).toHaveBeenCalledWith('/test-workspace/photo.png')
    expect(wiki.ingest).not.toHaveBeenCalled()  // 关键：不能走 wiki.ingest
    expect(result.type).toBe('image')
    expect(result.ocrText).toBe('混凝土配合比')
  })

  test('workspace_ingest 收到 jpg 文件 → 走 imageIngest 分支', async () => {
    const wiki = makeMockWiki()
    const wm = {
      ...makeMockWM(),
      current: () => ({ path: '/test-workspace' }),
      _ingestImageAsync: jest.fn().mockResolvedValue({ ocrText: 'x', description: 'y' })
    }
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_ingest')
    await skill.execute({ filename: 'defect.jpg' }, {})
    expect(wm._ingestImageAsync).toHaveBeenCalledWith('/test-workspace/defect.jpg')
  })

  test('workspace_ingest 收到 webp 文件 → 走 imageIngest 分支', async () => {
    const wiki = makeMockWiki()
    const wm = {
      ...makeMockWM(),
      current: () => ({ path: '/test-workspace' }),
      _ingestImageAsync: jest.fn().mockResolvedValue({ ocrText: 'x', description: 'y' })
    }
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_ingest')
    await skill.execute({ filename: 'mix-design.webp' }, {})
    expect(wm._ingestImageAsync).toHaveBeenCalledWith('/test-workspace/mix-design.webp')
  })

  test('workspace_ingest 收到 png 但工作区未打开 → 返回 NOT_OPEN 错误', async () => {
    const wiki = makeMockWiki()
    const wm = {
      ...makeMockWM(),
      current: () => null,  // 工作区未开
      _ingestImageAsync: jest.fn()
    }
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: wiki, kgExtractor: null })
    const skill = skills.find(s => s.name === 'workspace_ingest')
    const result = await skill.execute({ filename: 'photo.png' }, {})
    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_OPEN')
    expect(wm._ingestImageAsync).not.toHaveBeenCalled()
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
    expect(result.code).toBe('NOT_OPEN')
    expect(result.title).toContain('知识图谱未启用')
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
      code: 'PAGE_NOT_FOUND',
      title: 'wiki 页不存在: x.md'
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
      code: ErrorCodes.UNKNOWN,
      title: 'boom'
    })
    expect(result.details && result.details.stack).toContain('boom')
  })

  // ===== 集成：SkillRegistry.register 能成功 =====

  test('所有 26 个伪 Skill 能被 SkillRegistry.register 接受（验证 4 字段协议）', () => {
    const SkillRegistry = require('../../agent/SkillRegistry')
    const reg = new SkillRegistry()
    const skills = buildWorkspaceSkills({
      workspaceManager: makeMockWM(),
      wikiEngine: makeMockWiki(),
      kgExtractor: null
    })
    for (const s of skills) {
      reg.register(s, { builtin: true, filePath: '<workspace-pseudo>' })
    }
    expect(reg.size).toBe(26)
    const schemas = reg.getToolSchemas()
    const names = schemas.map(sc => sc.function.name).sort()
    expect(names).toEqual([
      'workspace_grep', 'workspace_ingest', 'workspace_lint', 'workspace_listFiles',
      'workspace_readPage', 'workspace_search', 'workspace_searchGraph', 'workspace_writeFile',
      'workspace_readRaw', 'workspace_organize', 'workspace_recordAnswer',
      'workspace_analyze', 'workspace_mkdir', 'workspace_archiveReports',
      'read_office_file', 'edit_office_file', 'batch_office_edit',
      'query_office_elements', 'refresh_office_doc',
      'create_office_file', 'merge_office_template',
      'move_office_element', 'validate_office_file',
      'import_office_csv', 'officecli_raw', 'officecli_help'
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
    expect(result.code).toBe('NOT_OPEN')
    expect(result.title).toContain('请先打开工作区')
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

// v11.7.0: 老板 2026-07-21 速查手册场景端到端验证
// ponytail: fs mock 必须在所有 require 之后才激活（babel 内部用 fs 解析 config）

describe('v11.7.0 officecli 全能力补齐 — 老板速查手册场景', () => {
  let officecli
  let execSpy, availSpy, addTableSpy

  beforeEach(() => {
    // ① 先 require（此时 fs 未被 mock，babel 正常解析）
    officecli = require('../../officecli/officecli-bridge')
    // 2026-08-23 异步化适配：officecli 桥接全部返回 Promise，mock 用 mockResolvedValue
    execSpy = jest.spyOn(officecli, 'execOfficeCliAsync').mockResolvedValue({ stdout: '', stderr: '' })
    availSpy = jest.spyOn(officecli, 'checkAvailability').mockResolvedValue({
      available: true, version: '1.0.0', path: '/x/officecli.exe'
    })
    addTableSpy = jest.spyOn(officecli, 'addTable').mockResolvedValue({ stdout: '/body/tbl[1]', stderr: '' })

    // ② require 完成后再 patch fs（后续 skill.execute 的 fs.existsSync 调用走 mock）
    _fs.existsSync = jest.fn().mockReturnValue(true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    _fs.existsSync = _origExistsSync
  })

  test('add 段落完整 props 透传（中文仿宋+英文新罗马+小四+首行缩进+1.5倍行距）', async () => {
    const wm = { current: () => ({ path: '/ws' }) }
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: makeMockWiki(), kgExtractor: null })
    const edit = skills.find(s => s.name === 'edit_office_file')

    const result = await edit.execute({
      filePath: 'reports/速查手册.docx',
      operations: [{
        action: 'add',
        path: '/body',
        type: 'paragraph',
        value: '粗骨料应满足 JGJ 52-2006 第 3.1.1 条要求',
        props: {
          'font.ea': '仿宋',
          'font.latin': 'Times New Roman',
          size: '12pt',
          firstLineIndent: '480',  // 2 字符 × 12pt × 20 twips/pt = 480
          lineSpacing: '360',      // 1.5 倍 × 240 = 360
          lineRule: 'auto'
        }
      }]
    }, {})

    expect(result.success).toBe(true)
    expect(execSpy).toHaveBeenCalled()
    // 找出 add 调用的 args
    const addCall = execSpy.mock.calls.find(c => c[0] && c[0][0] === 'add')
    expect(addCall).toBeDefined()
    const args = addCall[0]
    expect(args).toContain('--type')
    expect(args).toContain('paragraph')
    expect(args).toContain('text=粗骨料应满足 JGJ 52-2006 第 3.1.1 条要求')
    expect(args).toContain('font.ea=仿宋')
    expect(args).toContain('font.latin=Times New Roman')
    expect(args).toContain('size=12pt')
    expect(args).toContain('firstLineIndent=480')
    expect(args).toContain('lineSpacing=360')
    expect(args).toContain('lineRule=auto')
  })

  test('add_table action 透传到 addTable 桥接', async () => {
    const wm = { current: () => ({ path: '/ws' }) }
    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: makeMockWiki(), kgExtractor: null })
    const edit = skills.find(s => s.name === 'edit_office_file')

    const rowsData = [
      ['检测项目', 'Ⅰ类', 'Ⅱ类'],
      ['碎石压碎指标/%', '≤10', '≤20']
    ]
    const result = await edit.execute({
      filePath: 'reports/速查手册.docx',
      operations: [{
        action: 'add_table',
        path: '/body',
        rows: 2,
        cols: 3,
        colWidths: [2000, 1500, 1500],
        rowsData
      }]
    }, {})

    expect(result.success).toBe(true)
    expect(addTableSpy).toHaveBeenCalledTimes(1)
    const callArgs = addTableSpy.mock.calls[0]
    expect(callArgs[1]).toBe('/body')  // parentPath
    expect(callArgs[2]).toMatchObject({
      rows: 2, cols: 3, colWidths: [2000, 1500, 1500], rowsData
    })
  })

  test('set 操作触发 UNSUPPORTED_PROP 时透传错误码', async () => {
    const wm = { current: () => ({ path: '/ws' }) }
    // 模拟 setElementText 抛 UNSUPPORTED 错误
    execSpy.mockImplementation(() => {
      throw new Error('UNSUPPORTED props on /body/p[1]: text (not supported)')
    })

    const skills = buildWorkspaceSkills({ workspaceManager: wm, wikiEngine: makeMockWiki(), kgExtractor: null })
    const edit = skills.find(s => s.name === 'edit_office_file')

    const result = await edit.execute({
      filePath: 'reports/速查手册.docx',
      operations: [{ action: 'set', path: '/body/p[1]', value: 'x' }]
    }, {})

    expect(result.success).toBe(true)  // 整体成功，但 result.results[0].status = 'error'
    expect(result.data.results[0].status).toBe('error')
    expect(result.data.results[0].error.code).toBe('UNSUPPORTED_PROP')
  })

  test('add_table schema 暴露 rows/cols/colWidths/rowsData 字段', () => {
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: makeMockWiki(), kgExtractor: null })
    const edit = skills.find(s => s.name === 'edit_office_file')
    const itemsSchema = edit.parameters.operations.items
    expect(itemsSchema.properties.action.enum).toContain('add_table')
    expect(itemsSchema.properties.rows).toBeDefined()
    expect(itemsSchema.properties.cols).toBeDefined()
    expect(itemsSchema.properties.colWidths).toBeDefined()
    expect(itemsSchema.properties.rowsData).toBeDefined()
    // props 描述必须包含中文仿宋/英文新罗马关键词（老板速查手册格式要求）
    expect(itemsSchema.properties.props.description).toContain('font.ea')
    expect(itemsSchema.properties.props.description).toContain('font.latin')
    expect(itemsSchema.properties.props.description).toContain('firstLineIndent')
    expect(itemsSchema.properties.props.description).toContain('lineSpacing')
  })

  // v11.7.0: officecli_help 技能验证
  test('officecli_help 参数 schema 正确（format/verb/element/json）', async () => {
    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: makeMockWiki(), kgExtractor: null })
    const help = skills.find(s => s.name === 'officecli_help')
    expect(help).toBeDefined()
    expect(help.parameters.format.enum).toEqual(['docx', 'xlsx', 'pptx', 'all'])
    expect(help.parameters.format.required).toBe(true)
    expect(help.parameters.verb.required).toBe(false)
    expect(help.parameters.element.required).toBe(false)
    expect(help.parameters.json.default).toBe(false)
  })

  test('officecli_help 调 officecliHelp bridge 并返回结果', async () => {
    const officecli = require('../../officecli/officecli-bridge')
    const helpSpy = jest.spyOn(officecli, 'officecliHelp').mockReturnValue('paragraph items...')

    const skills = buildWorkspaceSkills({ workspaceManager: makeMockWM(), wikiEngine: makeMockWiki(), kgExtractor: null })
    const help = skills.find(s => s.name === 'officecli_help')

    const result = await help.execute({ format: 'docx', verb: 'add' }, {})
    expect(result.success).toBe(true)
    expect(helpSpy).toHaveBeenCalledWith({ format: 'docx', verb: 'add', element: undefined, json: undefined })
    expect(result.data.result).toBe('paragraph items...')
  })
})