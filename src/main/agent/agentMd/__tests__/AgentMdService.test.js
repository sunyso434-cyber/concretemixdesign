const fs = require('fs')
const path = require('path')
const os = require('os')
const { AgentMdService } = require('../AgentMdService')

describe('AgentMdService.bak 备份', () => {
  let tmpDir, agentMdPath

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-md-test-'))
    agentMdPath = path.join(tmpDir, 'agent.md')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('saveToFile 写入前自动备份到 .bak', async () => {
    fs.writeFileSync(agentMdPath, '## 老内容\n- 老规则', 'utf8')
    const svc = new AgentMdService({ path: agentMdPath })
    svc.loadFromFile()

    await svc.saveToFile('## 新内容\n- 新规则')

    expect(fs.readFileSync(agentMdPath + '.bak', 'utf8')).toBe('## 老内容\n- 老规则')
    expect(fs.readFileSync(agentMdPath, 'utf8')).toBe('## 新内容\n- 新规则')
  })

  test('loadFromFile 主文件读取失败时 fallback 到 .bak', () => {
    // 主文件用 UTF-16 LE BOM 写入，_decodeUtf8 会抛错（"检测到 UTF-16 编码"）
    fs.writeFileSync(agentMdPath, Buffer.from([0xFF, 0xFE, 0x61, 0x00]))
    // .bak 是正常的
    const goodContent = `## 回复规范
- 中文回复`
    fs.writeFileSync(agentMdPath + '.bak', goodContent, 'utf8')

    const svc = new AgentMdService({ path: agentMdPath })
    svc.loadFromFile()

    expect(svc.cache.version).toBe(2)
    expect(svc.cache.sections[0].title).toBe('回复规范')
  })
})

describe('AgentMdService 写锁', () => {
  let tmpDir, agentMdPath

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-md-lock-'))
    agentMdPath = path.join(tmpDir, 'agent.md')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('并发 saveToFile 按顺序执行不丢失', async () => {
    const svc = new AgentMdService({ path: agentMdPath })
    svc.loadFromFile()

    // 并发触发 5 次 saveToFile
    const promises = []
    for (let i = 0; i < 5; i++) {
      promises.push(svc.saveToFile(`## 第${i}次\n- 内容${i}`))
    }
    await Promise.all(promises)

    // 最终结果应是最后一次写入
    const final = fs.readFileSync(agentMdPath, 'utf8')
    expect(final).toContain('第4次')

    // 每次写入前 .bak 应保留前一次内容
    expect(fs.existsSync(agentMdPath + '.bak')).toBe(true)
  })
})