const fs = require('fs')
const path = require('path')
const os = require('os')
const { createAsyncLogWriter, flushAll } = require('../asyncLogWriter')

describe('createAsyncLogWriter', () => {
  let dir, file

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-log-'))
    file = path.join(dir, 'test.log')
  })

  afterEach(async () => {
    // 清理前先 flush，避免异步写入残留句柄
    await flushAll()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('append 后 300ms 内批量落盘', async () => {
    const writer = createAsyncLogWriter(file)
    writer.append('line1\n')
    writer.append('line2\n')
    // 落盘前不应有内容（还在队列里）
    expect(fs.existsSync(file)).toBe(false)
    await new Promise(r => setTimeout(r, 500))
    expect(fs.readFileSync(file, 'utf-8')).toBe('line1\nline2\n')
  })

  test('写入失败不抛出（吞错并打控制台）', async () => {
    // 指向一个目录路径导致 appendFile 失败
    const badPath = path.join(dir, 'not-a-file')
    fs.mkdirSync(badPath)
    const writer = createAsyncLogWriter(badPath)
    expect(() => writer.append('x\n')).not.toThrow()
    await new Promise(r => setTimeout(r, 500))
  })

  test('flushAll 立即落盘全部 writer 的队列（不等 300ms）', async () => {
    const file2 = path.join(dir, 'test2.log')
    createAsyncLogWriter(file).append('a\n')
    createAsyncLogWriter(file2).append('b\n')
    await flushAll()
    expect(fs.readFileSync(file, 'utf-8')).toBe('a\n')
    expect(fs.readFileSync(file2, 'utf-8')).toBe('b\n')
  })
})
