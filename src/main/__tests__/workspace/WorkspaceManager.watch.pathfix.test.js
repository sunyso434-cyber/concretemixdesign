// v4.9.1 hotfix 回归测试 - 验证 chokidar 在 Windows 路径下能正确计算相对路径
const path = require('path')
const fs = require('fs').promises
const os = require('os')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WorkspaceManager.watch path fix (v4.9.1)', () => {
  let mgr, testPath

  beforeEach(async () => {
    testPath = path.join(os.tmpdir(), `watch-pathfix-${Date.now()}-${Math.random().toString(36).slice(2,8)}`)
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
  })

  afterEach(async () => {
    await mgr.unwatch?.()
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('Windows 路径下拖入 .md 文件能自动 ingest（不 FILE_NOT_FOUND）', async () => {
    const engine = new WikiEngine({ workspace: mgr })
    mgr.watch(engine)

    // 等 chokidar ready
    await new Promise(r => setTimeout(r, 1500))

    // 模拟老板拖入
    const mdPath = path.join(testPath, 'test.md')
    await fs.writeFile(mdPath, '# Hello\n\nTest content')

    // 等 chokidar 1s 去勣 + ingest
    await new Promise(r => setTimeout(r, 2500))

    // 验证 wiki/sources/test.md 存在
    const wikiPath = path.join(testPath, 'wiki', 'sources', 'test.md')
    const stat = await fs.stat(wikiPath).catch(() => null)
    expect(stat).toBeTruthy()
    expect(stat.size).toBeGreaterThan(0)
  }, 15000)

  test('拖入子目录里的 .txt 文件也能 ingest', async () => {
    const engine = new WikiEngine({ workspace: mgr })
    mgr.watch(engine)

    await new Promise(r => setTimeout(r, 1500))

    // 创子目录 + 文件
    const subDir = path.join(testPath, 'docs')
    await fs.mkdir(subDir, { recursive: true })
    const txtPath = path.join(subDir, 'note.txt')
    await fs.writeFile(txtPath, 'Some text content')

    await new Promise(r => setTimeout(r, 2500))

    const wikiPath = path.join(testPath, 'wiki', 'sources', 'note.md')
    const stat = await fs.stat(wikiPath).catch(() => null)
    expect(stat).toBeTruthy()
  }, 15000)
})
