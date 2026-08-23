const path = require('path')
const fs = require('fs').promises
const os = require('os')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine.search', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    // 2026-08-23 修复：改用系统临时目录——此前 afterEach 会 rm 整个 git 跟踪的 fixtures 目录，
    // 每次跑测试后 git status 变脏（fixtures 显示为已删除）
    testPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-search-test-'))
    await fs.mkdir(testPath, { recursive: true })
    // 3 个测试文件（v1.5.3 修订：直接放工作区根目录，去掉 raw/）
    await fs.writeFile(path.join(testPath, '抗渗.md'), '# 抗渗混凝土\n\n抗渗混凝土水胶比不应大于 0.45。')
    await fs.writeFile(path.join(testPath, '普通.md'), '# 普通混凝土\n\n普通混凝土配合比设计。')
    await fs.writeFile(path.join(testPath, '抗冻.md'), '# 抗冻融\n\n抗冻融混凝土水胶比。')
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
    await wiki.ingest({ filename: '抗渗.md' })
    await wiki.ingest({ filename: '普通.md' })
    await wiki.ingest({ filename: '抗冻.md' })
  })

  afterEach(async () => {
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('search 返回值结构：path/title/snippet/score/sourceType', async () => {
    const results = await wiki.search('抗渗', 5)
    expect(results.length).toBeGreaterThan(0)
    const hit = results[0]
    expect(hit).toHaveProperty('path')
    expect(hit).toHaveProperty('title')
    expect(hit).toHaveProperty('snippet')
    expect(hit).toHaveProperty('score')
    expect(hit).toHaveProperty('sourceType', 'wiki')
  })

  test('search "抗渗" → 抗渗.md 排第一', async () => {
    const results = await wiki.search('抗渗', 5)
    expect(results[0].path).toContain('抗渗')
  })

  test('snippet 含命中上下文（前后各 50/150 字符）', async () => {
    const results = await wiki.search('水胶比', 5)
    const hit = results.find(r => r.path.includes('抗渗'))
    expect(hit).toBeDefined()
    // snippet 应包含「水胶比」或包含前后省略号
    expect(hit.snippet).toMatch(/水胶比|…/)
  })

  test('中英混合 query', async () => {
    const results = await wiki.search('混凝土 抗渗', 5)
    expect(results.length).toBeGreaterThan(0)
  })

  test('空 query 返回空数组', async () => {
    const results = await wiki.search('', 5)
    expect(results).toEqual([])
  })

  test('topK 限制返回数量', async () => {
    const results = await wiki.search('混凝土', 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  test('NOT_OPEN 状态抛 WorkspaceError', async () => {
    await mgr.close()
    await expect(wiki.search('test', 5)).rejects.toMatchObject({ code: 'NOT_OPEN' })
  })
})
