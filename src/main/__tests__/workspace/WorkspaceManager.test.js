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
    expect(subdirs).toEqual(expect.arrayContaining(['wiki', 'reports', 'chat-history']))
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