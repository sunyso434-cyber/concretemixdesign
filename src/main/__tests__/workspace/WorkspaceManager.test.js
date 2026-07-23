const path = require('path')
const os = require('os')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WorkspaceError } = require('../../workspace/WorkspaceError')

describe('WorkspaceManager', () => {
  let mgr
  const testPath = path.join(__dirname, 'fixtures/test-workspace')

  beforeEach(async () => {
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
  })
  afterEach(async () => {
    mgr.close()
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('初始状态 idle', () => {
    expect(mgr.current()).toBeNull()
  })

  test('open 合法路径 → ready', async () => {
    await mgr.open(testPath)
    expect(mgr.current().status).toBe('ready')
    expect(mgr.current().path).toBe(testPath.replace(/\\/g, '/'))
  })

  test('open 不存在路径 → PATH_INVALID', async () => {
    await expect(mgr.open('/nonexistent/path')).rejects.toMatchObject({ code: 'PATH_INVALID' })
  })

  test('open 后自动建子目录', async () => {
    await mgr.open(testPath)
    const subdirs = await fs.readdir(testPath)
    expect(subdirs).toEqual(expect.arrayContaining(['wiki', 'reports']))
  })

  test('未 open 时 listFiles 抛 NOT_OPEN', async () => {
    await expect(mgr.listFiles('root')).rejects.toMatchObject({ code: 'NOT_OPEN' })
  })

  test('listFiles(root) 列出工作区根文件', async () => {
    await fs.writeFile(path.join(testPath, 'test.pdf'), 'fake')
    await mgr.open(testPath)
    const files = await mgr.listFiles('root')
    expect(files.find(f => f.name === 'test.pdf')).toBeTruthy()
  })

  // ==================== v2026-06-22: listFiles 扩展 ====================

  test('listFiles 默认行为：只列文件 + 不递归 + 不含 ingested 字段（向后兼容）', async () => {
    await fs.mkdir(path.join(testPath, 'sub'), { recursive: true })
    await fs.writeFile(path.join(testPath, 'a.txt'), 'x')
    await fs.writeFile(path.join(testPath, 'sub', 'b.txt'), 'y')
    await fs.writeFile(path.join(testPath, '.hidden'), 'z')
    await mgr.open(testPath)
    const files = await mgr.listFiles('root')
    expect(files.map(f => f.name)).toEqual(['a.txt'])  // 隐藏文件和子目录文件都不在
    expect(files[0].type).toBe('file')
    expect(files[0].ingested).toBeUndefined()  // 默认不附 ingested
  })

  test('listFiles({recursive:true}) 递归子目录', async () => {
    await fs.mkdir(path.join(testPath, 'wiki', 'sources'), { recursive: true })
    await fs.writeFile(path.join(testPath, 'a.txt'), 'x')
    await fs.writeFile(path.join(testPath, 'wiki', 'sources', 'b.md'), 'y')
    await mgr.open(testPath)
    const files = await mgr.listFiles('root', { recursive: true })
    const names = files.map(f => f.name).sort()
    expect(names).toEqual(['a.txt', 'b.md'])
  })

  test('listFiles({includeDirs:true}) 包含目录条目', async () => {
    await fs.mkdir(path.join(testPath, 'wiki'), { recursive: true })
    await mgr.open(testPath)
    const files = await mgr.listFiles('root', { includeDirs: true })
    expect(files.find(f => f.type === 'dir' && f.name === 'wiki')).toBeTruthy()
  })

  test('listFiles({withIngestStatus:true}) 附带 ingested 状态', async () => {
    const { saveIndex } = require('../../workspace/index-store')
    await fs.writeFile(path.join(testPath, 'ingested.txt'), 'x')
    await fs.writeFile(path.join(testPath, 'pending.txt'), 'y')
    await mgr.open(testPath)
    await saveIndex(testPath, {
      version: 1,
      workspacePath: testPath.replace(/\\/g, '/'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastFullRebuild: new Date().toISOString(),
      files: {
        'ingested.txt': {
          hash: 'sha256:abc', mtime: 0, size: 1,
          wikiPage: 'sources/ingested-123456.md',
          lastIngestAt: 1700000000000, quality: 'high', ingestVersion: 2
        }
      },
      bm25Index: { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 },
      chatBM25Index: { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
    })
    const files = await mgr.listFiles('root', { withIngestStatus: true })
    const ingestedFile = files.find(f => f.name === 'ingested.txt')
    const pendingFile = files.find(f => f.name === 'pending.txt')
    expect(ingestedFile.ingested).toBe(true)
    expect(ingestedFile.wikiPage).toBe('sources/ingested-123456.md')
    expect(ingestedFile.quality).toBe('high')
    expect(pendingFile.ingested).toBe(false)
  })

  test('listFiles 不存在的子目录 → 返回空数组（不抛错）', async () => {
    await mgr.open(testPath)
    const files = await mgr.listFiles('nonexistent-dir')
    expect(files).toEqual([])
  })

  test('listFiles 索引损坏时 withIngestStatus 不抛错', async () => {
    await fs.writeFile(path.join(testPath, 'corrupt-index.txt'), 'x')
    await mgr.open(testPath)
    // 写入损坏的索引
    await fs.writeFile(path.join(testPath, '.workspace-index.json'), '{ not valid json')
    // 不应抛错，所有文件 ingested=false
    const files = await mgr.listFiles('root', { withIngestStatus: true })
    const f = files.find(x => x.name === 'corrupt-index.txt')
    expect(f.ingested).toBe(false)
  })

  // ==================== attachSync (Task 2.15) ====================

  describe('attachSync', () => {
    let mockSync

    beforeEach(() => {
      mockSync = {
        onWorkspaceChange: jest.fn().mockResolvedValue(undefined)
      }
    })

    test('attachSync 绑定后首次 open 不调 onWorkspaceChange（无旧工作区可 flush）', async () => {
      // v4.10.0 fix: oldPath 为 null 时不调 onWorkspaceChange（无需 flush）
      mgr.attachSync(mockSync)
      await mgr.open(testPath)
      expect(mockSync.onWorkspaceChange).not.toHaveBeenCalled()
    })

    test('attachSync 绑定后切换工作区调 onWorkspaceChange(oldPath, newPath)', async () => {
      await mgr.open(testPath)
      mgr.attachSync(mockSync)
      const oldPath = mgr.current().path

      // 重新 open 另一个路径触发切换
      const newDir = path.join(os.tmpdir(), `ws-switch-${Date.now()}`)
      await fs.mkdir(newDir, { recursive: true })
      try {
        jest.clearAllMocks()
        await mgr.open(newDir)
        expect(mockSync.onWorkspaceChange).toHaveBeenCalledWith(oldPath, newDir.replace(/\\/g, '/'))
      } finally {
        await fs.rm(newDir, { recursive: true, force: true })
      }
    })

    test('attachSync 绑定后 close 调 onWorkspaceChange(oldPath, null)', async () => {
      await mgr.open(testPath)
      mgr.attachSync(mockSync)
      const oldPath = mgr.current().path

      await mgr.close()

      expect(mockSync.onWorkspaceChange).toHaveBeenCalledWith(oldPath, null)
    })

    test('未 attachSync 时 open/close 不抛错', async () => {
      await mgr.open(testPath)
      expect(() => mgr.close()).not.toThrow()
    })

    test('onWorkspaceChange 失败时不阻塞 open', async () => {
      mockSync.onWorkspaceChange.mockRejectedValue(new Error('sync failed'))
      mgr.attachSync(mockSync)

      // open 应该仍成功
      await mgr.open(testPath)
      expect(mgr.current().status).toBe('ready')
    })
  })
})