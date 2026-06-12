const fs = require('fs')
const path = require('path')
const os = require('os')
const { rotateIfNeeded } = require('../logRotator')

describe('logRotator', () => {
  let tmpDir
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-rotate-'))
  })
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('文件超过 5MB 应轮转', () => {
    const logPath = path.join(tmpDir, 'test.log')
    fs.writeFileSync(logPath, 'x'.repeat(5 * 1024 * 1024 + 1), 'utf8')
    rotateIfNeeded(logPath, { maxSize: 5 * 1024 * 1024, maxFiles: 5 })
    expect(fs.existsSync(logPath + '.1')).toBe(true)
    const stat = fs.statSync(logPath)
    expect(stat.size).toBe(0)
  })

  test('文件未超阈值不应轮转', () => {
    const logPath = path.join(tmpDir, 'test.log')
    fs.writeFileSync(logPath, 'small', 'utf8')
    rotateIfNeeded(logPath, { maxSize: 5 * 1024 * 1024, maxFiles: 5 })
    expect(fs.existsSync(logPath + '.1')).toBe(false)
  })

  test('文件不存在不应抛错', () => {
    const logPath = path.join(tmpDir, 'nonexistent.log')
    expect(() => rotateIfNeeded(logPath, { maxSize: 5 * 1024 * 1024, maxFiles: 5 })).not.toThrow()
  })

  test('多次轮转应保留 maxFiles 个旧文件', () => {
    const logPath = path.join(tmpDir, 'test.log')
    // 模拟已有 .1 ~ .4，再触发一次轮转
    fs.writeFileSync(logPath, 'current', 'utf8')
    fs.writeFileSync(logPath + '.1', 'a', 'utf8')
    fs.writeFileSync(logPath + '.2', 'b', 'utf8')
    fs.writeFileSync(logPath + '.3', 'c', 'utf8')
    fs.writeFileSync(logPath + '.4', 'd', 'utf8')
    // 把当前文件撑大到 5MB+1 触发轮转
    const big = 'x'.repeat(5 * 1024 * 1024 + 1)
    fs.writeFileSync(logPath, big, 'utf8')

    rotateIfNeeded(logPath, { maxSize: 5 * 1024 * 1024, maxFiles: 5 })

    // 旧 .4 应被删除；.1~.3 应平移为 .2~.4；当前轮转生成新的 .1
    expect(fs.existsSync(logPath + '.1')).toBe(true)
    expect(fs.existsSync(logPath + '.4')).toBe(true)
    expect(fs.existsSync(logPath + '.5')).toBe(false)
  })
})
