// src/main/__tests__/workspace/WikiEngine.readPage.layered.test.js
// readPage depth 分层读取测试（红线）

const path = require('path')
const fs = require('fs').promises
const matter = require('gray-matter')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { createTestWikiPage, buildSectionsFromContent } = require('./helpers')

describe('WikiEngine.readPage（分层读取）', () => {
  let tmpDir, mgr, engine

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), '.tmp', `readpage-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    for (const sub of ['wiki', 'wiki/sources', 'reports']) {
      await fs.mkdir(path.join(tmpDir, sub), { recursive: true })
    }
    mgr = new WorkspaceManager()
    await mgr.open(tmpDir)
    engine = new WikiEngine({ workspace: mgr })

    // 用 helper 生成 sections（不手写行号）
    const content = `## 原材料信息
水泥采用 P.O 42.5，28d 抗压强度 ≥ 42.5MPa。

## 强度检测结果
3d 强度 23.2MPa。
7d 强度 38.5MPa。
28d 强度 48.6MPa，超过标准 42.5MPa。

## 质量评定
合格，符合 GB175 标准要求。

## 施工工艺
建议水灰比 0.40，坍落度 180±20mm。
`
    const sections = buildSectionsFromContent(engine, content)
    await createTestWikiPage(path.join(tmpDir, 'wiki', 'sources'), 'test-page.md', content, {
      summary: '本测试页检测了水泥的强度指标',
      keyPoints: ['28d 抗压强度 48.6MPa'],
      sections,
      sections_version: 1
    })
  })

  afterEach(async () => {
    if (mgr) await mgr.close().catch(() => {})
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test("depth='relevant' + 有 sections → 返回相关段落 + 上下文", async () => {
    const result = await engine.readPage('sources/test-page.md', { query: '强度 28d', depth: 'relevant' })
    expect(result.depth).toBe('relevant')
    expect(result.content).toContain('强度检测结果')
    expect(result.content).toContain('48.6MPa')
    expect(result.content).toContain('原材料信息')  // 上下文
    expect(result.stats.mode).toBe('relevant')
    expect(result.stats.returnedSections).toBeGreaterThanOrEqual(1)
  })

  test("depth='relevant' + 无 sections → 降级为 _fullFiltered", async () => {
    const oldContent = '水泥强度 48.6MPa'
    await createTestWikiPage(path.join(tmpDir, 'wiki', 'sources'), 'old-page.md', oldContent, {
      summary: null, keyPoints: [], sections: [], sections_version: 0
    })
    const result = await engine.readPage('sources/old-page.md', { query: '水泥 强度', depth: 'relevant' })
    expect(result.stats.mode).toBe('relevant-fallback')
    expect(result.content).toContain('48.6MPa')
  })

  test("depth='relevant' + 无 query → fallthrough 到 _readPageFull", async () => {
    const result = await engine.readPage('sources/test-page.md', { depth: 'relevant' })
    // fallthrough 后走 _readPageFull 的 300KB 截断全文路径
    expect(result.content).toBeDefined()
    expect(result.frontmatter).toBeDefined()
    expect(result.mtime).toBeGreaterThan(0)
    expect(result.stats.mode).toBe('full')  // fallthrough 后 mode 变 full
  })

  test("depth='full' → 现有 4 阶段管线", async () => {
    const result = await engine.readPage('sources/test-page.md', { query: '强度', depth: 'full' })
    expect(result.content).toBeDefined()
    expect(result.frontmatter).toBeDefined()
    expect(result.mtime).toBeGreaterThan(0)
    expect(result.size).toBeGreaterThan(0)
  })

  test("depth='auto' → 等同于 relevant（有 query 时）", async () => {
    const a = await engine.readPage('sources/test-page.md', { query: '强度 28d', depth: 'auto' })
    const b = await engine.readPage('sources/test-page.md', { query: '强度 28d', depth: 'relevant' })
    expect(a.depth).toBe('relevant')
    expect(a.content).toBe(b.content)
  })

  test('sections 行号 vs _splitIntoSegments 行号 → 一致（回归）', async () => {
    const absPath = path.join(tmpDir, 'wiki', 'sources', 'test-page.md')
    const { data: fm, content } = matter(await fs.readFile(absPath, 'utf-8'))
    const segments = engine._splitIntoSegments(content)
    expect(segments.length).toBe(fm.sections.length)
    for (let i = 0; i < segments.length; i++) {
      expect(segments[i].startLine).toBe(fm.sections[i].startLine)
      expect(segments[i].endLine).toBe(fm.sections[i].endLine)
    }
  })
})
