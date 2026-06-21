// log-rotator (Task 6.6) 测试
// - log.md > 10MB 或 > 1000 条 → 归档到 wiki/log/log-YYYY-MM-DD-<ts>.md.gz
// - 保留近 30 天归档，更老的删
// - 归档后原 log.md 清空
// - gz 可解压还原
// - log.md 不存在 / 未达阈值 → noop
const path = require('path')
const fs = require('fs')
const fsp = require('fs').promises
const zlib = require('zlib')
const { promisify } = require('util')
const gunzip = promisify(zlib.gunzip)

const { rotateLog } = require('../../workspace/log-rotator')

describe('log-rotator (Task 6.6)', () => {
  let wsPath

  beforeEach(() => {
    wsPath = path.join(__dirname, 'fixtures/log-rot-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
  })

  afterEach(async () => {
    await fsp.rm(wsPath, { recursive: true, force: true }).catch(() => {})
  })

  async function ensureWorkspace() {
    await fsp.mkdir(path.join(wsPath, 'wiki'), { recursive: true })
  }

  test('log.md > 10MB → 归档到 wiki/log/log-YYYY-MM-DD-<ts>.md.gz', async () => {
    await ensureWorkspace()
    const logAbs = path.join(wsPath, 'wiki', 'log.md')
    // 11MB，触发 size 阈值
    await fsp.writeFile(logAbs, 'x'.repeat(11 * 1024 * 1024))

    const result = await rotateLog(wsPath)

    expect(result.archivedFiles).toHaveLength(1)
    expect(result.archivedFiles[0]).toMatch(/^log-\d{4}-\d{2}-\d{2}-\d+\.md\.gz$/)
    expect(result.totalBytesSaved).toBeGreaterThan(0)

    // 归档存在
    const archiveAbs = path.join(wsPath, 'wiki', 'log', result.archivedFiles[0])
    const archStat = await fsp.stat(archiveAbs)
    expect(archStat.size).toBeGreaterThan(0)
    // gz 可解压还原
    const decompressed = await gunzip(await fsp.readFile(archiveAbs))
    expect(decompressed.length).toBe(11 * 1024 * 1024)
    // 原 log.md 已清空
    const logRaw = await fsp.readFile(logAbs, 'utf-8')
    expect(logRaw).toBe('')
  })

  test('log.md > 1000 条也归档（即使 size 未达 10MB）', async () => {
    await ensureWorkspace()
    const logAbs = path.join(wsPath, 'wiki', 'log.md')
    // 1001 行 schema §4 格式
    const lines = []
    for (let i = 0; i < 1001; i++) {
      lines.push(`## [2026-06-22 10:${String(i % 60).padStart(2, '0')}] answer | q${i}`)
    }
    await fsp.writeFile(logAbs, lines.join('\n'))

    const result = await rotateLog(wsPath)

    expect(result.archivedFiles).toHaveLength(1)
    const archiveAbs = path.join(wsPath, 'wiki', 'log', result.archivedFiles[0])
    const decompressed = (await gunzip(await fsp.readFile(archiveAbs))).toString('utf-8')
    expect(decompressed.split('\n').filter(l => l.trim()).length).toBe(1001)
    const logRaw = await fsp.readFile(logAbs, 'utf-8')
    expect(logRaw).toBe('')
  })

  test('未达阈值（< 10MB 且 < 1000 条）→ 不归档', async () => {
    await ensureWorkspace()
    const logAbs = path.join(wsPath, 'wiki', 'log.md')
    // 100 行，未达 1000 行；size 也远小于 10MB
    const lines = []
    for (let i = 0; i < 100; i++) {
      lines.push(`## [2026-06-22 10:00] answer | q${i}`)
    }
    await fsp.writeFile(logAbs, lines.join('\n'))

    const result = await rotateLog(wsPath)

    expect(result.archivedFiles).toHaveLength(0)
    expect(result.totalBytesSaved).toBe(0)
    // log.md 原样保留
    const logRaw = await fsp.readFile(logAbs, 'utf-8')
    expect(logRaw).toBe(lines.join('\n'))
    // log/ 目录可能创建但不应当有任何归档文件
    const logDir = path.join(wsPath, 'wiki', 'log')
    try {
      const entries = await fsp.readdir(logDir)
      expect(entries).toHaveLength(0)
    } catch (err) {
      // 目录不存在也 OK
      expect(err.code).toBe('ENOENT')
    }
  })

  test('log.md 不存在 → noop，不报错', async () => {
    await ensureWorkspace()
    // 故意不写 log.md
    const result = await rotateLog(wsPath)
    expect(result.archivedFiles).toHaveLength(0)
    expect(result.totalBytesSaved).toBe(0)
  })

  test('> 30 天的归档被删除，< 30 天的保留', async () => {
    await ensureWorkspace()
    const logDir = path.join(wsPath, 'wiki', 'log')
    await fsp.mkdir(logDir, { recursive: true })

    // 准备归档文件：1 个 31 天前（应删），1 个 5 天前（应保留），1 个今天（应保留）
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const oldName = 'log-2026-05-22-100000.md.gz'
    const recentName = 'log-2026-06-17-100000.md.gz'
    const todayName = 'log-2026-06-22-100000.md.gz'

    for (const name of [oldName, recentName, todayName]) {
      await fsp.writeFile(path.join(logDir, name), Buffer.from('x'))
    }
    // 用 utimes 改 mtime（跨平台兼容性：用 stat + utimes）
    const oldFile = path.join(logDir, oldName)
    const recentFile = path.join(logDir, recentName)
    const todayFile = path.join(logDir, todayName)
    // 31 天前
    await fsp.utimes(oldFile, (now - 31 * day) / 1000, (now - 31 * day) / 1000)
    // 5 天前
    await fsp.utimes(recentFile, (now - 5 * day) / 1000, (now - 5 * day) / 1000)
    // 今天
    await fsp.utimes(todayFile, now / 1000, now / 1000)

    // 写一个 log.md 触发归档（顺便也会执行清理）
    await fsp.writeFile(path.join(wsPath, 'wiki', 'log.md'), 'y'.repeat(11 * 1024 * 1024))
    const result = await rotateLog(wsPath)

    // 31 天前的应该被清掉
    await expect(fsp.access(oldFile)).rejects.toMatchObject({ code: 'ENOENT' })
    // 5 天前 + 今天 应该还在
    await expect(fsp.access(recentFile)).resolves.toBeUndefined()
    await expect(fsp.access(todayFile)).resolves.toBeUndefined()
    // 本次新增归档也算一个
    expect(result.archivedFiles).toHaveLength(1)
    expect(result.archivedFiles[0]).toMatch(/^log-\d{4}-\d{2}-\d{2}-\d+\.md\.gz$/)
  })

  test('归档名包含日期戳（YYYY-MM-DD）', async () => {
    await ensureWorkspace()
    const logAbs = path.join(wsPath, 'wiki', 'log.md')
    await fsp.writeFile(logAbs, 'x'.repeat(11 * 1024 * 1024))

    const before = new Date().toISOString().slice(0, 10)
    const result = await rotateLog(wsPath)
    const after = new Date().toISOString().slice(0, 10)

    // 归档名前缀的日期应是今天（前后 1 天容错处理跨日）
    const name = result.archivedFiles[0]
    const dateMatch = name.match(/^log-(\d{4}-\d{2}-\d{2})-/)
    expect(dateMatch).not.toBeNull()
    const datePart = dateMatch[1]
    // 应当等于今天（同步执行，不会跨天）
    expect([before, after]).toContain(datePart)
  })
})