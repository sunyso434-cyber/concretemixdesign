// WikiEngine.readPage 加固 (Task 2.7) 测试
// - 加 SIZE_EXCEEDED 检查（> 5MB 抛错）
// - 完整 frontmatter 校验（5 必填字段）
// - 返回值结构校验：result.content 是去 frontmatter 后的纯 markdown
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine.readPage (Task 2.7 加固)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-readpage-27-test')
    const sourcesDir = path.join(testPath, 'wiki', 'sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    // 写一个含完整 5 必填字段的 frontmatter 文件
    const nowIso = new Date().toISOString()
    const fullMd = `---
title: "test-page"
source: "raw/test.md"
ingested_at: "${nowIso}"
updated_at: "${nowIso}"
quality: "high"
---

# Test Page

This is test content.
`
    await fs.writeFile(path.join(sourcesDir, 'page.md'), fullMd)
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  // a. 读存在的页 → 成功 + frontmatter 字段完整（5 必填：title/source/ingested_at/updated_at/quality）
  test('readPage 成功 + frontmatter 含 5 必填字段 + content 是去 frontmatter 后的纯 markdown', async () => {
    const result = await wiki.readPage('sources/page.md')

    // frontmatter 5 必填字段
    expect(result.frontmatter).toMatchObject({
      title: 'test-page',
      source: 'raw/test.md',
      quality: 'high'
    })
    expect(typeof result.frontmatter.ingested_at).toBe('string')
    expect(typeof result.frontmatter.updated_at).toBe('string')
    expect(new Date(result.frontmatter.ingested_at).toString()).not.toBe('Invalid Date')

    // content 是去 frontmatter 后的纯 markdown（不含 frontmatter 分隔符）
    expect(result.content).toContain('# Test Page')
    expect(result.content).toContain('This is test content.')
    expect(result.content).not.toContain('---')
    expect(result.content).not.toContain('frontmatter')

    // mtime/size 是数字
    expect(typeof result.mtime).toBe('number')
    expect(result.mtime).toBeGreaterThan(0)
    expect(typeof result.size).toBe('number')
    expect(result.size).toBeGreaterThan(0)
  })

  // b. 读不存在的页 → PAGE_NOT_FOUND
  test('readPage 不存在的页抛 PAGE_NOT_FOUND', async () => {
    await expect(wiki.readPage('sources/nope.md')).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND'
    })
  })

  // c. 读含 `..` 的路径 → PATH_INVALID
  test('readPage 路径含 .. 抛 PATH_INVALID', async () => {
    await expect(wiki.readPage('sources/../../etc/passwd')).rejects.toMatchObject({
      code: 'PATH_INVALID'
    })
  })

  // d. 读 > 5MB → SIZE_EXCEEDED
  test('readPage 文件 > 5MB 抛 SIZE_EXCEEDED', async () => {
    // 写一个 6MB 的测试文件（> 5 * 1024 * 1024 = 5242880 bytes）
    const bigPath = path.join(testPath, 'wiki', 'sources', 'huge.md')
    const bigContent = 'x'.repeat(6 * 1024 * 1024)
    await fs.writeFile(bigPath, bigContent)

    await expect(wiki.readPage('sources/huge.md')).rejects.toMatchObject({
      code: 'SIZE_EXCEEDED'
    })
  })

  // e. 返回值结构：result.frontmatter 必含 5 字段；result.content 是去 frontmatter 后的纯 markdown
  test('readPage 返回值结构：frontmatter 5 字段 + content 是纯 markdown + mtime/size 是数字', async () => {
    const result = await wiki.readPage('sources/page.md')

    // 5 必填字段
    const required = ['title', 'source', 'ingested_at', 'updated_at', 'quality']
    for (const k of required) {
      expect(result.frontmatter).toHaveProperty(k)
    }

    // content 是纯 markdown（不含 --- 分隔符）
    expect(result.content).not.toMatch(/^---/)
    expect(result.content.trim().startsWith('# Test Page')).toBe(true)

    // mtime/size 是数字且 > 0
    expect(typeof result.mtime).toBe('number')
    expect(result.mtime).toBeGreaterThan(0)
    expect(typeof result.size).toBe('number')
    expect(result.size).toBeGreaterThan(0)
  })

  // Task 2: 不传 query → 行为等价于旧行为（content 未被截断，因为内容 < 300KB）
  test('Task 2: 不传 query → 行为等价于旧行为', async () => {
    const result = await wiki.readPage('sources/page.md')

    // content 和旧行为一致
    expect(result.content).toContain('# Test Page')
    expect(result.content).toContain('This is test content.')
    expect(result.content).not.toContain('已截断')

    // frontmatter / mtime / size 结构不变
    expect(result.frontmatter).toHaveProperty('title', 'test-page')
    expect(typeof result.mtime).toBe('number')
    expect(typeof result.size).toBe('number')
  })

  // Task 2: 不传 query + 内容 > 300KB → 被截断
  test('Task 2: 不传 query + 内容 > 300KB → 被截断', async () => {
    // 写一个 > 300KB 的 wiki 页（需要包含段落分隔符 \n\n，模拟真实 wiki 内容）
    const bigPath = path.join(testPath, 'wiki', 'sources', 'big.md')
    const nowIso = new Date().toISOString()
    // 生成 ~350KB 的段落内容（每个段落 1KB，段落间用 \n\n 分隔）
    const paragraph = 'x'.repeat(1024)
    const paragraphs = []
    for (let i = 0; i < 350; i++) {
      paragraphs.push(paragraph)
    }
    const body = paragraphs.join('\n\n')
    const bigMd = `---
title: "big-page"
source: "raw/big.md"
ingested_at: "${nowIso}"
updated_at: "${nowIso}"
quality: "high"
---

${body}
`
    await fs.writeFile(bigPath, bigMd)

    const result = await wiki.readPage('sources/big.md')

    // 被截断
    expect(result.content).toContain('已截断')
    expect(result.content.length).toBeLessThan(body.length)

    // 截断后 UTF-8 字节数 <= 300KB
    const byteLen = Buffer.byteLength(result.content, 'utf-8')
    expect(byteLen).toBeLessThanOrEqual(300 * 1024)
  })

  // Task 2: stats.elapsedMs 存在且 > 0
  test('Task 2: stats.elapsedMs 存在且 >= 0', async () => {
    const result = await wiki.readPage('sources/page.md')

    expect(result.stats).toBeDefined()
    expect(typeof result.stats.elapsedMs).toBe('number')
    expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  // Task 2: 传 query 时 content 不被截断（< 300KB 内容）
  test('Task 2: 传 query 时 content 不做 300KB 截断', async () => {
    const result = await wiki.readPage('sources/page.md', { query: 'test' })

    expect(result.content).toContain('# Test Page')
    expect(result.content).not.toContain('已截断')
    expect(result.stats).toBeDefined()
  })
})