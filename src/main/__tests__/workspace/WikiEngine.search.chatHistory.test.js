/**
 * Task 3.4: workspace:search 范围扩展含 chat-history
 *
 * - chatBM25Index 字段加到 .workspace-index.json
 * - WikiEngine.search 合并 wiki + chat-history 两个索引
 * - chat-history 命中 sourceType = 'chatHistory'
 * - 不破坏现有 wiki 搜索
 */

const path = require('path')
const fs = require('fs').promises
const os = require('os')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { loadIndex, saveIndex } = require('../../workspace/index-store')

describe('WikiEngine.search 含 chat-history (Task 3.4)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    // 2026-08-23 修复：改用系统临时目录——此前 afterEach 会 rm 整个 git 跟踪的 fixtures 目录，
    // 每次跑测试后 git status 变脏（fixtures 显示为已删除）
    testPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-search-ch-'))
    await fs.rm(testPath, { recursive: true, force: true })
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('基础命中：chat-history 下的 session.md 加入索引后可被搜到', async () => {
    // 准备 1 个 wiki 源 + 1 个 chat-history session
    await fs.writeFile(path.join(testPath, '抗渗.md'), '# 抗渗混凝土\n\n抗渗混凝土水胶比。')
    await wiki.ingest({ filename: '抗渗.md' })

    // 写 chat-history session.md
    const slug = 'sessionA1'
    const sessionDir = path.join(testPath, 'wiki', 'chat-history', slug)
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(
      path.join(sessionDir, 'session.md'),
      '---\nsessionId: sessionA1xx\n---\n\n# 历史问答\n\n聊到 抗渗混凝土 水胶比 0.45 设计。\n'
    )

    // 手动把 session.md 加入 chatBM25Index（模拟 exportSession 触发）
    const index = await loadIndex(testPath)
    const { buildBM25 } = require('../../workspace/bm25')
    index.chatBM25Index = buildBM25([
      { path: 'chat-history/sessionA1/session.md', content: await fs.readFile(path.join(sessionDir, 'session.md'), 'utf-8') }
    ])
    await saveIndex(testPath, index)

    const results = await wiki.search('抗渗', 5)
    // 应该至少有一个 chat-history 命中
    const chatHits = results.filter(r => r.sourceType === 'chatHistory')
    expect(chatHits.length).toBeGreaterThan(0)
    expect(chatHits[0].path).toContain('chat-history')
  })

  test('sourceType 区分：wiki 命中 → wiki，chat-history 命中 → chatHistory', async () => {
    await fs.writeFile(path.join(testPath, '抗冻.md'), '# 抗冻融\n\n抗冻融混凝土水胶比。')
    await wiki.ingest({ filename: '抗冻.md' })

    const slug = 'sessB2xx'.substring(0, 8)
    const sessionDir = path.join(testPath, 'wiki', 'chat-history', slug)
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(
      path.join(sessionDir, 'session.md'),
      '---\nsessionId: sessB2xx\n---\n\n# 历史问答\n\n聊到 抗冻融 配合比 设计。\n'
    )

    const index = await loadIndex(testPath)
    const { buildBM25 } = require('../../workspace/bm25')
    const md = await fs.readFile(path.join(sessionDir, 'session.md'), 'utf-8')
    index.chatBM25Index = buildBM25([
      { path: `chat-history/${slug}/session.md`, content: md }
    ])
    await saveIndex(testPath, index)

    const results = await wiki.search('抗冻融', 5)
    expect(results.length).toBeGreaterThan(0)

    const types = new Set(results.map(r => r.sourceType))
    expect(types.has('wiki')).toBe(true)
    expect(types.has('chatHistory')).toBe(true)
  })

  test('不破坏 wiki 搜索：仅 wiki 源时 search 返回值结构与原版一致', async () => {
    await fs.writeFile(path.join(testPath, 'note.md'), '# 普通混凝土\n\n普通混凝土配合比设计。')
    await wiki.ingest({ filename: 'note.md' })

    // 没有 chatBM25Index 字段（模拟旧 index）
    const results = await wiki.search('普通', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('path')
    expect(results[0]).toHaveProperty('title')
    expect(results[0]).toHaveProperty('snippet')
    expect(results[0]).toHaveProperty('score')
    expect(results[0]).toHaveProperty('sourceType', 'wiki')
  })

  test('chatBM25Index 缺失时不报错（默认空索引）', async () => {
    await fs.writeFile(path.join(testPath, 'spec.md'), '# spec\n\n测试容错。')
    await wiki.ingest({ filename: 'spec.md' })

    // 强制把 chatBM25Index 字段删掉，模拟旧版 index
    const index = await loadIndex(testPath)
    delete index.chatBM25Index
    await saveIndex(testPath, index)

    const results = await wiki.search('容错', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].sourceType).toBe('wiki')
  })

  test('chat-history 命中 path 字段含 chat-history 路径', async () => {
    await fs.writeFile(path.join(testPath, 'doc.md'), '# 测试文档\n\n无关内容。')
    await wiki.ingest({ filename: 'doc.md' })

    const slug = 'sessionC3'.substring(0, 8)
    const sessionDir = path.join(testPath, 'wiki', 'chat-history', slug)
    await fs.mkdir(sessionDir, { recursive: true })
    const md = '---\nsessionId: sessionC3xx\n---\n\n# 历史问答\n\n聊到 配合比 设计 经验。\n'
    await fs.writeFile(path.join(sessionDir, 'session.md'), md)

    const index = await loadIndex(testPath)
    const { buildBM25 } = require('../../workspace/bm25')
    index.chatBM25Index = buildBM25([
      { path: `chat-history/${slug}/session.md`, content: md }
    ])
    await saveIndex(testPath, index)

    const results = await wiki.search('配合比 经验', 5)
    const chatHit = results.find(r => r.sourceType === 'chatHistory')
    expect(chatHit).toBeDefined()
    expect(chatHit.path).toContain('chat-history')
    expect(chatHit.path).toContain('session.md')
  })
})