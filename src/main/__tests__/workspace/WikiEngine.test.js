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