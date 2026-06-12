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

  // 测试 4: saveToFile 持久化 + 更新缓存
  test('saveToFile 应写入文件并同步更新缓存', () => {
    const svc = new AgentMdService({ path: tmpFile })
    const content = `---
version: 1
---

# 我的智能助手规则

## 专业偏好
- 默认强度：C30
`
    svc.saveToFile(content)

    expect(fs.existsSync(tmpFile)).toBe(true)
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe(content)
    const cached = svc.getCached()
    expect(cached.raw).toBe(content)
    expect(cached.parsed.professionalPrefs['默认强度']).toBe('C30')
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
