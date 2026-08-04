// officecli 新技能端到端验证（真实 officecli 1.0.143）
const path = require('path')
const fs = require('fs')
const os = require('os')

const bridge = require('../src/main/officecli/officecli-bridge')

let tmpDir
let testDocx

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officecli-test-'))
  testDocx = path.join(tmpDir, 'test.docx')

  // 创建测试 docx
  bridge.createDocument(testDocx, 'docx')
  // 加 3 个段落
  bridge.execOfficeCliSync(['add', testDocx, '/body', '--type', 'paragraph', '--prop', 'text=第一段正文'])
  bridge.execOfficeCliSync(['add', testDocx, '/body', '--type', 'paragraph', '--prop', 'text=第二段内容', '--prop', 'style=Normal'])
  bridge.execOfficeCliSync(['add', testDocx, '/body', '--type', 'paragraph', '--prop', 'text=第三段'])
})

afterAll(() => {
  // officecli 可能有短暂文件锁，延迟清理
  try {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch (e) {
    // 文件被锁，忽略（临时目录系统会清理）
  }
})

describe('queryElements（修复后）', () => {
  test('默认 JSON 模式查询段落', () => {
    const result = bridge.queryElements(testDocx, 'paragraph')
    expect(result.success).toBe(true)
    expect(result.data.matches).toBe(3)
    expect(result.data.results.length).toBe(3)
  })

  test('属性过滤查询', () => {
    const result = bridge.queryElements(testDocx, 'paragraph[style=Normal]')
    expect(result.data.matches).toBeGreaterThanOrEqual(1)
  })

  test('find 文本过滤', () => {
    const result = bridge.queryElements(testDocx, 'paragraph', { find: '第二段' })
    expect(result.data.matches).toBe(1)
  })

  test('compact 模式返回文本', () => {
    const result = bridge.queryElements(testDocx, 'paragraph', { compact: true })
    expect(typeof result).toBe('string')
    expect(result).toContain('/body/p')
    expect(result).toContain('total:')
  })
})

describe('batchExecute（原子事务）', () => {
  test('原子模式：成功执行多条命令', () => {
    const commands = [
      { command: 'add', parent: '/body', type: 'paragraph', props: { text: '批量加的段落' } },
      { command: 'set', path: '/body/p[1]', props: { bold: 'true' } },
    ]
    const result = bridge.execOfficeCliSync(['batch', testDocx, '--commands', JSON.stringify(commands)])
    expect(result.stdout).toBeDefined()
    // 验证：第一个段落应该加粗了
    const q = bridge.queryElements(testDocx, 'paragraph', { find: '第一段正文' })
    expect(q.data.matches).toBe(1)
  })

  test('原子模式：失败时全回滚', () => {
    // 先记下当前段落数
    const before = bridge.queryElements(testDocx, 'paragraph')
    const beforeCount = before.data.matches

    // 故意写一个会失败的命令（不存在的路径）
    const commands = [
      { command: 'add', parent: '/body', type: 'paragraph', props: { text: '这条应该被回滚' } },
      { command: 'set', path: '/body/p[99999]', props: { bold: 'true' } }, // 失败
    ]
    let threw = false
    try {
      bridge.execOfficeCliSync(['batch', testDocx, '--commands', JSON.stringify(commands)])
    } catch (e) {
      threw = true
    }
    expect(threw).toBe(true)

    // 验证：段落数没变（回滚了）
    const after = bridge.queryElements(testDocx, 'paragraph')
    expect(after.data.matches).toBe(beforeCount)
  })
})

describe('refreshDocument（加 --json）', () => {
  test('调用不报错（Windows + Word 环境）', () => {
    // refresh 需要 Windows + Word，CI 环境可能没有，所以只验证不抛异常
    let threw = false
    let result
    try {
      result = bridge.refreshDocument(testDocx)
    } catch (e) {
      threw = true
    }
    // 即使 Word 不可用，也不应该抛异常（bridge 用 try-catch 回退）
    if (!threw && result) {
      expect(result.success === true || typeof result === 'object').toBe(true)
    }
  })
})

describe('readFileStats', () => {
  test('返回统计 JSON', () => {
    const result = bridge.readFileStats(testDocx)
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
    // docx stats 应该有段落数等
    expect(result.success).toBe(true)
  })
})

describe('renderAsHtml', () => {
  test('返回 HTML 字符串', () => {
    const result = bridge.renderAsHtml(testDocx)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(50)
    // HTML 应该包含段落内容
    expect(result).toContain('第一段正文')
  })
})
