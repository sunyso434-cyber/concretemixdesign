const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const fs = require('fs').promises
const path = require('path')

describe('WorkspaceManager.watch', () => {
  let mgr, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/watch-test')
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
  })

  afterEach(async () => {
    await mgr.unwatch?.()  // 防止 watcher 泄漏
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('watch 创建 watcher 实例', () => {
    const fakeEngine = { ingest: jest.fn() }
    mgr.watch(fakeEngine)
    expect(mgr._watcher).toBeDefined()
  })

  test('watch 重复调用会关闭旧 watcher', () => {
    const fakeEngine = { ingest: jest.fn() }
    mgr.watch(fakeEngine)
    const oldWatcher = mgr._watcher
    mgr.watch(fakeEngine)
    expect(mgr._watcher).not.toBe(oldWatcher)
  })
})
