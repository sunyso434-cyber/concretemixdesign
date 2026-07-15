// WikiEngine.lint (Task 2.8) 测试 - spec §4.2
// - 5 类检查：missingFrontmatter / orphans / missingCrossRefs / staleSummaries / contradictions
// - LintReport 结构：{ missingFrontmatter, orphans, missingCrossRefs, staleSummaries, contradictions, scannedAt }
// - scannedAt 是 ISO 字符串
// - contradictions 始终是空数组（V1.5 可选，本任务不实现）
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine.lint (Task 2.8)', () => {
  let mgr, wiki, testPath

  afterEach(async () => {
    await mgr.close()
    if (testPath) await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('a. missingFrontmatter: frontmatter 缺 title → 报告里 missing 含 ["title"]', async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-lint-missing-fm-test')
    const sourcesDir = path.join(testPath, 'wiki/sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    // 故意不写 title
    await fs.writeFile(
      path.join(sourcesDir, 'a.md'),
      '---\nsource: "raw/a.md"\ningested_at: "2026-06-19T00:00:00Z"\nquality: "high"\n---\n\n# a\n\n正文'
    )
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })

    const report = await wiki.lint()

    expect(report.missingFrontmatter).toHaveLength(1)
    expect(report.missingFrontmatter[0].path).toBe('sources/a.md')
    expect(report.missingFrontmatter[0].missing).toEqual(expect.arrayContaining(['title']))
  })

  test('b. orphans: 2 个 wiki 页互不引用 → 都是 orphans', async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-lint-orphans-test')
    const sourcesDir = path.join(testPath, 'wiki/sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(sourcesDir, 'a.md'),
      `---\ntitle: "a"\nsource: "raw/a.md"\ningested_at: "${now}"\nquality: "high"\n---\n\n# a\n\n没有引用的页 A`
    )
    await fs.writeFile(
      path.join(sourcesDir, 'b.md'),
      `---\ntitle: "b"\nsource: "raw/b.md"\ningested_at: "${now}"\nquality: "high"\n---\n\n# b\n\n没有引用的页 B`
    )
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })

    const report = await wiki.lint()

    expect(report.orphans).toHaveLength(2)
    const orphanPaths = report.orphans.map(o => o.path).sort()
    expect(orphanPaths).toEqual(['sources/a.md', 'sources/b.md'])
  })

  test('c. missingCrossRefs: 正文含 [[nonexistent]] → 报告里 ref 是 nonexistent', async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-lint-cross-refs-test')
    const sourcesDir = path.join(testPath, 'wiki/sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    const now = new Date().toISOString()
    // 写一个自引用的页（a 引用 b 自己），和一个被引用的页（让 a 引用 c 但 c 不存在）
    await fs.writeFile(
      path.join(sourcesDir, 'a.md'),
      `---\ntitle: "a"\nsource: "raw/a.md"\ningested_at: "${now}"\nquality: "high"\n---\n\n# a\n\n参考 [[sources/b]]`
    )
    await fs.writeFile(
      path.join(sourcesDir, 'b.md'),
      `---\ntitle: "b"\nsource: "raw/b.md"\ningested_at: "${now}"\nquality: "high"\n---\n\n# b\n\n参考 [[concepts/nonexistent]]`
    )
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })

    const report = await wiki.lint()

    expect(report.missingCrossRefs).toHaveLength(1)
    expect(report.missingCrossRefs[0].path).toBe('sources/b.md')
    expect(report.missingCrossRefs[0].ref).toBe('concepts/nonexistent')
  })

  test('d. staleSummaries: 源文件 mtime > wiki 页 mtime → 报告含源路径', async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-lint-stale-test')
    const sourcesDir = path.join(testPath, 'wiki/sources')
    const rawDir = path.join(testPath, 'raw')
    await fs.mkdir(sourcesDir, { recursive: true })
    await fs.mkdir(rawDir, { recursive: true })

    // 写一个 wiki 页（较早 mtime）
    const wikiFile = path.join(sourcesDir, 'a.md')
    await fs.writeFile(
      wikiFile,
      `---\ntitle: "a"\nsource: "raw/a.md"\ningested_at: "2026-06-01T00:00:00Z"\nupdated_at: "2026-06-01T00:00:00Z"\nquality: "high"\n---\n\n# a\n\n旧内容`
    )
    // 强制把 wiki 页的 mtime 调成过去
    const past = new Date('2026-06-01T00:00:00Z')
    await fs.utimes(wikiFile, past, past)

    // 写一个源文件（较新 mtime）
    const rawFile = path.join(rawDir, 'a.md')
    await fs.writeFile(rawFile, '# a\n\n新内容')
    const future = new Date('2026-06-19T12:00:00Z')
    await fs.utimes(rawFile, future, future)

    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })

    const report = await wiki.lint()

    expect(report.staleSummaries).toHaveLength(1)
    expect(report.staleSummaries[0].path).toBe('sources/a.md')
    expect(report.staleSummaries[0].sourceFile).toBe('raw/a.md')
    expect(report.staleSummaries[0].sourceMtime).toBeGreaterThan(report.staleSummaries[0].wikiMtime)
  })

  test('e. scannedAt 是 ISO 字符串 + 正常情况 contradictions 是空数组', async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-lint-scannedat-test')
    const sourcesDir = path.join(testPath, 'wiki/sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    // 空 wiki/ —— 全部报告为空
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })

    const report = await wiki.lint()

    expect(report.contradictions).toEqual([])
    expect(report.missingFrontmatter).toEqual([])
    expect(report.orphans).toEqual([])
    expect(report.missingCrossRefs).toEqual([])
    expect(report.staleSummaries).toEqual([])
    expect(typeof report.scannedAt).toBe('string')
    // ISO 8601 格式（允许 Z 或明确时区偏移）
    expect(report.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
    // 能被 Date 解析
    expect(new Date(report.scannedAt).toString()).not.toBe('Invalid Date')
  })

  test('NOT_OPEN 状态抛 WorkspaceError', async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-lint-notopen-test')
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
    await mgr.close()

    await expect(wiki.lint()).rejects.toMatchObject({ code: 'NOT_OPEN' })
  })
})
