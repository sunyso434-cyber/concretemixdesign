// 日志模块单测：验证按天文件名与超期日志清理逻辑
const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('electron', () => ({
  app: { getPath: jest.fn() }
}))
jest.mock('electron-log/main', () => ({
  initialize: jest.fn(),
  transports: { file: {}, console: {} },
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}))

const { app } = require('electron')
const { cleanupOldLogs, todayFileName } = require('../log')

let workDir

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logtest-'))
  app.getPath.mockReturnValue(workDir)
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('log.js', () => {
  test('todayFileName 返回 app-YYYY-MM-DD.log 格式', () => {
    const name = todayFileName()
    expect(name).toMatch(/^app-\d{4}-\d{2}-\d{2}\.log$/)
    const d = new Date()
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(name).toBe(`app-${ymd}.log`)
  })

  test('cleanupOldLogs 删除超期日志、保留当日与未来与非本格式文件', () => {
    // 日志实际位于 <userData>/logs 子目录
    const logsDir = path.join(workDir, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })

    const today = todayFileName()
    const files = [
      today,
      today + '.old',
      'app-2000-01-01.log',
      'app-2000-01-01.log.old',
      'app-2099-12-31.log',
      'random.txt',
      'readme.log'
    ]
    for (const f of files) fs.writeFileSync(path.join(logsDir, f), 'x')

    cleanupOldLogs()

    const remaining = fs.readdirSync(logsDir).sort()
    expect(remaining).toEqual(
      [today, today + '.old', 'app-2099-12-31.log', 'random.txt', 'readme.log'].sort()
    )
  })

  test('日志目录不存在时清理不抛错', () => {
    expect(() => cleanupOldLogs()).not.toThrow()
  })
})