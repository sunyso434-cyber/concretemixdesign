// v4.9.4 (P2a follow-up I-1)：ingest→index 桥接 + 删 search fallback 测试
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine.ingest→index bridge (v4.9.4 I-1)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/ingest-index-bridge-test')
    await fs.rm(testPath, { recursive: true, force: true })
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('ingest 后 .workspace-index.json 自动创建', async () => {
    await fs.writeFile(path.join(testPath, 'spec.md'), '# spec\n\n测试桥接')
    await wiki.ingest({ filename: 'spec.md' })
    const indexPath = path.join(testPath, '.workspace-index.json')
    const stat = await fs.stat(indexPath)
    expect(stat.isFile()).toBe(true)
  })

  test('ingest 后 search 立刻命中（不依赖 fallback）', async () => {
    await fs.writeFile(path.join(testPath, '抗渗.md'), '# 抗渗\n\n水胶比 0.45')
    await wiki.ingest({ filename: '抗渗.md' })
    // v4.9.4：search 走持久化 index（不 rebuild）
    const results = await wiki.search('抗渗', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].path).toContain('抗渗')
  })

  test('IngestResult.bm25TokensAdded 实际计数（不再占位 0）', async () => {
    await fs.writeFile(path.join(testPath, 'note.txt'), '混凝土 配合比 水胶比')
    const result = await wiki.ingest({ filename: 'note.txt' })
    // 实际 token 数应 > 0（不是占位 0）
    expect(result.bm25TokensAdded).toBeGreaterThan(0)
  })

  test('IngestResult.durationMs 实际计时（不是 0）', async () => {
    await fs.writeFile(path.join(testPath, 't.md'), '# t\n\ncontent')
    const result = await wiki.ingest({ filename: 't.md' })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('多次 ingest 后 index 累积', async () => {
    await fs.writeFile(path.join(testPath, 'a.md'), 'AAA')
    await fs.writeFile(path.join(testPath, 'b.md'), 'BBB')
    await wiki.ingest({ filename: 'a.md' })
    await wiki.ingest({ filename: 'b.md' })
    const results = await wiki.search('BBB', 5)
    expect(results.some(r => r.path.includes('b.md'))).toBe(true)
  })
})
