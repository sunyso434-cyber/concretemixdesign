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
    await expect(wiki.readPage('sources/../../etc/passwd')).rejects.toThrow(/不合法/)
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

    // v1.5.3 修订：IngestResult 必须含 bm25TokensAdded 字段（Task 2.5 占位）
    expect(result).toHaveProperty('bm25TokensAdded', 0)
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