const fs = require('fs')
const path = require('path')
const os = require('os')
const { AgentMdService } = require('../agentMd/AgentMdService')

describe('AgentMdService - 核心 IO + 缓存', () => {
  let tmpDir
  let tmpFile

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmd-svc-'))
    tmpFile = path.join(tmpDir, 'agent.md')
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // 测试 1: 文件不存在时不抛错，缓存为空结构
  test('loadFromFile 应在文件不存在时初始化为空结构且不抛错', () => {
    const svc = new AgentMdService({ path: tmpFile })
    expect(() => svc.loadFromFile()).not.toThrow()
    const cached = svc.getCached()
    expect(cached.raw).toBe('')
    expect(cached.parsed.version).toBe(1)
    expect(cached.parsed.replyStyle).toEqual({})
    expect(cached.parsed.workflow).toEqual([])
  })

  // 测试 2: 文件存在时正确加载并缓存
  test('loadFromFile 应正确读取并缓存文件内容', () => {
    const content = `---
version: 1
---

# 我的智能助手规则

## 回复风格
- 语气：专业但亲切
- 称呼：王工

## 工作流程
1. 先确认工程部位
2. 再确认强度等级
`
    fs.writeFileSync(tmpFile, content, 'utf8')

    const svc = new AgentMdService({ path: tmpFile })
    svc.loadFromFile()

    const cached = svc.getCached()
    expect(cached.raw).toBe(content)
    expect(cached.parsed.replyStyle['语气']).toBe('专业但亲切')
    expect(cached.parsed.replyStyle['称呼']).toBe('王工')
    expect(cached.parsed.workflow).toEqual(['先确认工程部位', '再确认强度等级'])
  })

  // 测试 3: getFormattedRules 输出 Markdown
  test('getFormattedRules 应返回格式化后的 Markdown 字符串', () => {
    const content = `---
version: 1
---

# 我的智能助手规则

## 回复风格
- 语气：专业
`
    fs.writeFileSync(tmpFile, content, 'utf8')

    const svc = new AgentMdService({ path: tmpFile })
    svc.loadFromFile()
    const md = svc.getFormattedRules()
    expect(typeof md).toBe('string')
    expect(md).toContain('## 回复风格')
    expect(md).toContain('语气')
    expect(md).toContain('专业')
  })

  // 测试 4: saveToFile 持久化 + 更新缓存（v2 professionalPrefs 形态：fenced YAML code block）
  test('saveToFile 应写入文件并同步更新缓存', () => {
    const svc = new AgentMdService({ path: tmpFile })
    const content = `---
version: 1
---

# 我的智能助手规则

## 专业偏好

\`\`\`yaml
materials:
  - category: 水泥
    dimension: 厂家
    value: 海螺
  - category: 掺合料
    dimension: 种类
    value: II级粉煤灰
method: 假定表观密度法
\`\`\`
`
    svc.saveToFile(content)

    expect(fs.existsSync(tmpFile)).toBe(true)
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe(content)
    const cached = svc.getCached()
    expect(cached.raw).toBe(content)
    expect(cached.parsed.professionalPrefs.materials).toEqual([
      { category: '水泥', dimension: '厂家', value: '海螺' },
      { category: '掺合料', dimension: '种类', value: 'II级粉煤灰' }
    ])
    expect(cached.parsed.professionalPrefs.method).toBe('假定表观密度法')
  })

  // 测试 5: saveToFile 自动创建目录
  test('saveToFile 应在目录不存在时自动创建', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'sub', 'agent.md')
    const svc = new AgentMdService({ path: nestedPath })
    svc.saveToFile('# 我的智能助手规则\n')

    expect(fs.existsSync(nestedPath)).toBe(true)
    expect(fs.readFileSync(nestedPath, 'utf8')).toContain('智能助手规则')
  })
})

describe('AgentMdService - chokidar 文件监听', () => {
  let tmpDir
  let tmpFile

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmd-watch-'))
    tmpFile = path.join(tmpDir, 'agent.md')
  })

  afterEach(async () => {
    // 确保 watcher 关闭
  })

  // 测试 6: 外部修改文件后缓存自动刷新
  test('外部修改文件后 chokidar 应触发缓存刷新', async () => {
    const initial = `---
version: 1
---

# 我的智能助手规则

## 回复风格
- 语气：初始
`
    fs.writeFileSync(tmpFile, initial, 'utf8')

    const svc = new AgentMdService({ path: tmpFile })
    svc.init() // loadFromFile + startWatching

    expect(svc.getCached().parsed.replyStyle['语气']).toBe('初始')

    // 等待 chokidar 启动稳定
    await new Promise(r => setTimeout(r, 300))

    // 外部修改
    const updated = initial.replace('初始', '修改后')
    fs.writeFileSync(tmpFile, updated, 'utf8')

    // 等待 chokidar awaitWriteFinish (200ms) + 余量
    await new Promise(r => setTimeout(r, 800))

    expect(svc.getCached().parsed.replyStyle['语气']).toBe('修改后')

    svc.stopWatching()
  }, 10000)
})

describe('AgentMdService - 边缘情况（编码/文件大小/BOM）', () => {
  let tmpDir
  let tmpFile

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmd-edge-'))
    tmpFile = path.join(tmpDir, 'agent.md')
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // 测试 7: 文件超大（>1MB）应返回警告
  test('文件超大（>1MB）应返回警告', () => {
    const big = 'x'.repeat(1024 * 1024 + 1)
    fs.writeFileSync(tmpFile, big, 'utf8')
    const service = new AgentMdService({ path: tmpFile })
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
    service.loadFromFile()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('过大'))
    consoleSpy.mockRestore()
  })

  // 测试 8: 非 UTF-8 编码（GBK）应抛出友好错误
  test('非 UTF-8 编码应抛出友好错误', () => {
    // GBK 编码写入（"你好"）
    const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3])
    fs.writeFileSync(tmpFile, gbk)
    const service = new AgentMdService({ path: tmpFile })
    expect(() => service.loadFromFile()).toThrow(/UTF-8/)
  })

  // 测试 9: UTF-8 BOM 头应被自动剥离
  test('UTF-8 BOM 头应被自动剥离', () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF])
    const content = Buffer.from('## 回复风格\n- 语气：有BOM', 'utf8')
    const withBom = Buffer.concat([bom, content])
    fs.writeFileSync(tmpFile, withBom)
    const service = new AgentMdService({ path: tmpFile })
    service.loadFromFile()
    const cached = service.getCached()
    expect(cached.parsed.replyStyle['语气']).toBe('有BOM')
  })

  // 测试 10: UTF-16 LE BOM 应被检测并报错
  test('UTF-16 LE BOM 应被检测并报错', () => {
    const bom = Buffer.from([0xFF, 0xFE])
    fs.writeFileSync(tmpFile, bom)
    const service = new AgentMdService({ path: tmpFile })
    expect(() => service.loadFromFile()).toThrow(/UTF-16/)
  })
})
