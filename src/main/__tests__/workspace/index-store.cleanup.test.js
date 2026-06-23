const path = require('path')
const os = require('os')
const fs = require('fs').promises
const { cleanupOrphanTmps } = require('../../workspace/index-store')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')

describe('index-store.cleanupOrphanTmps', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-cleanup-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('目录不存在 → 返回 0，不抛错', async () => {
    const removed = await cleanupOrphanTmps(path.join(tmpDir, 'nope'))
    expect(removed).toBe(0)
  })

  test('空目录 → 返回 0', async () => {
    const removed = await cleanupOrphanTmps(tmpDir)
    expect(removed).toBe(0)
  })

  test('清理所有 .workspace-index.json.tmp.*', async () => {
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.111'), 'a')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.222'), 'b')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.333'), 'c')

    const removed = await cleanupOrphanTmps(tmpDir)
    expect(removed).toBe(3)

    const remaining = await fs.readdir(tmpDir)
    expect(remaining.filter(n => n.startsWith('.workspace-index.json.tmp.'))).toEqual([])
  })

  test('不动正式文件 .workspace-index.json', async () => {
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json'), '{"version":1}')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.999'), 'tmp')

    await cleanupOrphanTmps(tmpDir)

    const content = await fs.readFile(path.join(tmpDir, '.workspace-index.json'), 'utf-8')
    expect(content).toBe('{"version":1}')
  })

  test('不动其他无关文件（xlsx、md、PDF 等）', async () => {
    await fs.writeFile(path.join(tmpDir, 'report.xlsx'), 'x')
    await fs.writeFile(path.join(tmpDir, 'wiki.md'), 'y')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.555'), 'tmp')

    await cleanupOrphanTmps(tmpDir)

    const remaining = await fs.readdir(tmpDir)
    expect(remaining).toEqual(expect.arrayContaining(['report.xlsx', 'wiki.md']))
  })

  test('前缀相近但不是 tmp 的文件不动（如 .workspace-index.json.bak）', async () => {
    // 只匹配 .workspace-index.json.tmp.<ts>，前缀 .tmp. 必须出现
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.bak'), 'bak')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.777'), 'tmp')

    const removed = await cleanupOrphanTmps(tmpDir)
    expect(removed).toBe(1)

    const remaining = await fs.readdir(tmpDir)
    expect(remaining).toContain('.workspace-index.json.bak')
  })
})

describe('WorkspaceManager.open 触发清理孤儿 tmp', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-mgr-cleanup-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('open 时自动清理遗留的孤儿 tmp 文件', async () => {
    // 模拟"上次 saveIndex 中途崩溃"留下的 3 个孤儿 tmp
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.111'), 'a')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.222'), 'b')
    await fs.writeFile(path.join(tmpDir, '.workspace-index.json.tmp.333'), 'c')

    const mgr = new WorkspaceManager()
    await mgr.open(tmpDir)

    const remaining = await fs.readdir(tmpDir)
    const tmps = remaining.filter(n => n.startsWith('.workspace-index.json.tmp.'))
    expect(tmps).toEqual([])
  })

  test('open 成功后状态仍为 ready（清理失败不阻塞）', async () => {
    const mgr = new WorkspaceManager()
    await mgr.open(tmpDir)
    expect(mgr.current().status).toBe('ready')
  })
})