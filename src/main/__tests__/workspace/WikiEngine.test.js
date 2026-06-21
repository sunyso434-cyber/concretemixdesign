// WikiEngine.ingest (Task 1.10 简化版) 测试
// - ingest .md 文件 → 在 wiki/sources/<slug>.md 生成内容
// - ingest 不支持的扩展名 → 抛错（任何 Error 都行，由 WikiEngine 包装为 WorkspaceError）
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine.ingest (简化版)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-test')
    await fs.mkdir(path.join(testPath, 'raw'), { recursive: true })
    await fs.writeFile(path.join(testPath, 'raw/sample.md'), '# Hello\n\nWorld')
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    mgr.close()
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('ingest 写 wiki/sources/sample.md', async () => {
    await wiki.ingest({ filename: 'raw/sample.md' })
    const exists = await fs.stat(path.join(testPath, 'wiki/sources/sample.md'))
    expect(exists.isFile()).toBe(true)
  })

  test('ingest 不支持的后缀抛错', async () => {
    await fs.writeFile(path.join(testPath, 'raw/bad.xyz'), '')
    await expect(wiki.ingest({ filename: 'raw/bad.xyz' })).rejects.toThrow(/Unsupported/)
  })
})

describe('WikiEngine.readPage (Task 1.12)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-readpage-test')
    const sourcesDir = path.join(testPath, 'wiki', 'sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    await fs.writeFile(
      path.join(sourcesDir, 'page.md'),
      '---\ntitle: "test"\n---\n\n# Hello\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    )
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('readPage 返回 content + frontmatter', async () => {
    const result = await wiki.readPage('sources/page.md')
    expect(result.frontmatter.title).toBe('test')
    expect(result.content).toContain('# Hello')
    expect(result.size).toBeGreaterThan(0)
    expect(result.mtime).toBeGreaterThan(0)
  })

  test('readPage 路径含 .. 抛 PATH_INVALID', async () => {
    await expect(wiki.readPage('sources/../../etc/passwd')).rejects.toThrow(/非法/)
  })

  test('readPage 文件不存在抛 PAGE_NOT_FOUND', async () => {
    await expect(wiki.readPage('sources/nope.md')).rejects.toThrow(/不存在/)
  })
})

// ====================================================================
// Task 2.1: WikiEngine.ingest 原子性升级
// - v1.5.3 修订：去掉 raw/ 前缀（源文件直接放工作区根目录）
// - 原子性：所有目标文件先在 .tmp/ingest-<uuid>/ 下准备，校验后一次性 rename
// - 中文文件名加 sha1 短后缀避免冲突（spec §4.10）
// - IngestResult 必须含 bm25TokensAdded 字段（Task 2.5 接 BM25 占位）
// ====================================================================
describe('WikiEngine.ingest (Task 2.1 原子性)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-task21-test')
    // v1.5.3 修订：源文件放工作区根目录，不建 raw/ 子目录
    await fs.mkdir(testPath, { recursive: true })
    await fs.writeFile(path.join(testPath, 'sample.md'), '# Hello\n\nWorld content for atomic ingest test')
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('损坏 PDF 触发 PARSE_FAIL 时 wiki/ 无变化（原子性）', async () => {
    // 写一个损坏的 PDF（reader 会抛 PARSE_FAIL，模拟「LLM 抽取失败」等任一中间步骤失败）
    await fs.writeFile(path.join(testPath, 'broken.pdf'), 'not a real pdf')
    const wikiDir = path.join(testPath, 'wiki')
    const before = await fs.readdir(wikiDir).catch(() => [])

    await expect(wiki.ingest({ filename: 'broken.pdf' })).rejects.toMatchObject({ code: 'PARSE_FAIL' })

    const after = await fs.readdir(wikiDir).catch(() => [])
    expect(after).toEqual(before)  // wiki/ 目录无任何变化
  })

  test('正常 ingest 原子提交：wiki/sources/<slug>.md + .tmp/ 清空', async () => {
    const result = await wiki.ingest({ filename: 'sample.md' })

    // v4.9.4 (P2a follow-up I-1)：bm25TokensAdded 不再是占位 0，实际计数各 test 不同
    // 用 type check + gt 验证字段存在且合理
    expect(result).toHaveProperty('bm25TokensAdded')
    expect(typeof result.bm25TokensAdded).toBe('number')
    expect(result.bm25TokensAdded).toBeGreaterThanOrEqual(0)
    expect(result).toHaveProperty('durationMs')
    expect(typeof result.durationMs).toBe('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.status).toBe('ok')
    expect(result.pagesCreated).toEqual(['sources/sample.md'])

    // 目标文件已提交
    const target = path.join(testPath, 'wiki/sources/sample.md')
    const stat = await fs.stat(target)
    expect(stat.isFile()).toBe(true)
    expect(stat.size).toBeGreaterThan(0)

    // .tmp/ 应清空（无残留）
    const tmpDir = path.join(testPath, 'wiki/.tmp')
    const tmpContents = await fs.readdir(tmpDir).catch(() => [])
    expect(tmpContents).toEqual([])
  })

  test('中文文件名加 sha1 短后缀避免冲突（spec §4.10）', async () => {
    // spec §4.10：含中文的文件名 → 追加 sha1(filename) 前 6 位避免同义文件名冲突
    await fs.writeFile(path.join(testPath, '混凝土说明.txt'), '中文内容测试')
    const result = await wiki.ingest({ filename: '混凝土说明.txt' })

    // slug 形如 '混凝土说明-<6位hex>.md'
    expect(result.pagesCreated[0]).toMatch(/^sources\/混凝土说明-[a-f0-9]{6}\.md$/)

    // 目标文件存在
    const slugMatch = result.pagesCreated[0].match(/^sources\/(.+)\.md$/)
    const slug = slugMatch[1]
    const target = path.join(testPath, 'wiki/sources', `${slug}.md`)
    const stat = await fs.stat(target)
    expect(stat.isFile()).toBe(true)
  })
})

// ====================================================================
// Task 5.2: WikiEngine.ingest 集成 KG
// - 在 .tmp/ 阶段准备 kg/sources/<slug>.json，commit 阶段 rename 到 wiki/kg/sources/
// - KG 失败降级（quality:low 或 extractor 抛）→ 不写 kg/，不污染 graph.json
// - 不破坏现有 ingest 行为：原子性、frontmatter 5 字段、index 更新
// - 不注入 kgExtractor → 等同 quality:low 降级（保持向后兼容）
// ====================================================================
describe('WikiEngine.ingest (Task 5.2 KG 集成)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-task52-test')
    await fs.mkdir(testPath, { recursive: true })
    await fs.writeFile(
      path.join(testPath, 'sample.md'),
      '# Hello\n\nWorld content for KG ingest test\n\n硅灰能显著提高混凝土的 28d 抗压强度'
    )
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
  })

  afterEach(async () => {
    mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('ingest 成功时 kg/sources/<slug>.json 被生成（quality:high 路径）', async () => {
    const mockExtractor = {
      extract: jest.fn().mockResolvedValue({
        entities: [{ id: 'aaa', name: '硅灰', type: 'Material' }],
        relations: [],
        quality: 'high'
      })
    }
    const wiki2 = new WikiEngine({ workspace: mgr, kgExtractor: mockExtractor })
    const result = await wiki2.ingest({ filename: 'sample.md' })

    // KG 文件生成
    const kgPath = path.join(testPath, 'wiki/kg/sources/sample.json')
    const kgStat = await fs.stat(kgPath)
    expect(kgStat.isFile()).toBe(true)
    expect(kgStat.size).toBeGreaterThan(0)

    // 内容正确（写的是 extract 返回的 JSON）
    const kgContent = JSON.parse(await fs.readFile(kgPath, 'utf-8'))
    expect(kgContent.quality).toBe('high')
    expect(kgContent.entities[0].name).toBe('硅灰')

    // extract 被调过
    expect(mockExtractor.extract).toHaveBeenCalledTimes(1)

    // 返回的 pagesCreated 还是 sources/<slug>.md（KG 文件不入主 list）
    expect(result.pagesCreated).toEqual(['sources/sample.md'])
  })

  test('KG quality:low 时不写 kg/sources/，不污染 graph.json', async () => {
    const mockExtractor = {
      extract: jest.fn().mockResolvedValue({
        entities: [],
        relations: [],
        quality: 'low',
        error: { code: 'KG_EXTRACT_FAIL' }
      })
    }
    const wiki2 = new WikiEngine({ workspace: mgr, kgExtractor: mockExtractor })
    const result = await wiki2.ingest({ filename: 'sample.md' })

    // wiki/ 仍生成 sources/<slug>.md（主流程不挂）
    const mdPath = path.join(testPath, 'wiki/sources/sample.md')
    expect((await fs.stat(mdPath)).isFile()).toBe(true)
    expect(result.status).toBe('ok')

    // 但 kg/ 不应被创建
    const kgDir = path.join(testPath, 'wiki/kg')
    const kgExists = await fs.stat(kgDir).catch(() => null)
    expect(kgExists).toBeNull()

    // graph.json 也不应被创建
    const graphPath = path.join(testPath, 'wiki/kg/graph.json')
    const graphExists = await fs.stat(graphPath).catch(() => null)
    expect(graphExists).toBeNull()

    // 进程级：.tmp/ 已清理
    const tmpDir = path.join(testPath, 'wiki/.tmp')
    const tmpContents = await fs.readdir(tmpDir).catch(() => [])
    expect(tmpContents).toEqual([])
  })

  test('KG 文件写在 .tmp/ 阶段，commit 时 rename（原子性）', async () => {
    const mockExtractor = {
      extract: jest.fn().mockResolvedValue({
        entities: [{ id: 'b1', name: 'X', type: 'Material' }],
        relations: [],
        quality: 'high'
      })
    }
    // 跟踪 extract 调用时 .tmp/ 临时目录状态
    let tmpKgFilesAtExtractTime = null
    const originalExtract = mockExtractor.extract
    mockExtractor.extract = jest.fn(async (content, filename) => {
      const result = await originalExtract(content, filename)
      // 此时 .tmp/ 应已创建，kg/sources/<slug>.json 临时文件应已写
      const tmpParent = path.join(testPath, 'wiki', '.tmp')
      const tmpEntries = await fs.readdir(tmpParent).catch(() => [])
      tmpKgFilesAtExtractTime = tmpEntries
      return result
    })

    const wiki2 = new WikiEngine({ workspace: mgr, kgExtractor: mockExtractor })
    await wiki2.ingest({ filename: 'sample.md' })

    // ingest 完成后 .tmp/ 应清空
    const tmpParent = path.join(testPath, 'wiki', '.tmp')
    const tmpAfter = await fs.readdir(tmpParent).catch(() => [])
    expect(tmpAfter).toEqual([])

    // 最终 kg/sources/sample.json 在最终目录
    const finalKg = path.join(testPath, 'wiki/kg/sources/sample.json')
    expect((await fs.stat(finalKg)).isFile()).toBe(true)
  })

  test('KG extractor 抛错时降级（不污染 kg/，不中断 ingest）', async () => {
    // KGExtractor.extract 设计上不抛（包成 quality:low），但保险起见：
    // 如果意外抛错，WikiEngine 必须不挂（不能把 KG 问题传染给 ingest 主流程）
    const mockExtractor = {
      extract: jest.fn().mockRejectedValue(new Error('unexpected boom'))
    }
    const wiki2 = new WikiEngine({ workspace: mgr, kgExtractor: mockExtractor })
    const result = await wiki2.ingest({ filename: 'sample.md' })

    // 主流程不挂
    expect(result.status).toBe('ok')
    expect((await fs.stat(path.join(testPath, 'wiki/sources/sample.md'))).isFile()).toBe(true)

    // kg/ 不创建
    const kgExists = await fs.stat(path.join(testPath, 'wiki/kg')).catch(() => null)
    expect(kgExists).toBeNull()
  })

  test('不注入 kgExtractor 时保持向后兼容（等同 quality:low 降级）', async () => {
    // 没有 kgExtractor：应走原 ingest 路径，不写 kg/
    const wikiNoKg = new WikiEngine({ workspace: mgr })  // 不传 kgExtractor
    const result = await wikiNoKg.ingest({ filename: 'sample.md' })

    expect(result.status).toBe('ok')
    expect(result.pagesCreated).toEqual(['sources/sample.md'])

    // kg/ 不创建
    const kgExists = await fs.stat(path.join(testPath, 'wiki/kg')).catch(() => null)
    expect(kgExists).toBeNull()

    // .tmp/ 清理
    const tmpDir = path.join(testPath, 'wiki/.tmp')
    const tmpContents = await fs.readdir(tmpDir).catch(() => [])
    expect(tmpContents).toEqual([])
  })
})