const fs = require('fs')
const path = require('path')
const os = require('os')
const { AgentMdService } = require('../agentMd/AgentMdService')
const { buildSystemPrompt } = require('../systemPromptBuilder')

describe('agent.md 端到端集成', () => {
  let tmpDir
  let agentMdPath

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
    agentMdPath = path.join(tmpDir, 'agent.md')
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('保存 → 加载 → 注入 system prompt 完整链路', async () => {
    // 1. 创建并保存
    const svc = new AgentMdService({ path: agentMdPath })
    await svc.saveToFile(`## 回复风格
- 语气：非常专业
- 称呼：王工

## 工作流程
1. 确认工程部位
2. 确认强度等级
`)

    // 2. 模拟下次启动：新建实例读取
    const svc2 = new AgentMdService({ path: agentMdPath })
    svc2.loadFromFile()

    // 3. 注入 system prompt
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      agentMdRules: svc2.getFormattedRules()
    })

    expect(prompt).toContain('非常专业')
    expect(prompt).toContain('王工')
    expect(prompt).toContain('确认工程部位')
  })

  test('外部修改后 chokidar 触发 → 缓存更新', done => {
    // 先写一份初始内容
    fs.writeFileSync(agentMdPath, '## 回复风格\n- 语气：初始', 'utf8')
    const svc = new AgentMdService({ path: agentMdPath })
    svc.init()

    setTimeout(() => {
      fs.writeFileSync(agentMdPath, '## 回复风格\n- 语气：外部修改', 'utf8')
      setTimeout(() => {
        expect(svc.getCached().parsed.replyStyle['语气']).toBe('外部修改')
        svc.stopWatching()
        done()
      }, 800)
    }, 200)
  }, 10000)

  test('保存后缓存一致性（自身 save 后 cache 立即反映新值）', async () => {
    const svc = new AgentMdService({ path: agentMdPath })
    svc.init() // init 内部先 loadFromFile（空文件）+ startWatching

    // 自身 save 后缓存应立即更新（不等 chokidar 回调）
    await svc.saveToFile('## 回复风格\n- 语气：自身保存')
    expect(svc.getCached().parsed.replyStyle['语气']).toBe('自身保存')

    // 再次 save 也应一致
    await svc.saveToFile('## 回复风格\n- 语气：再次保存')
    expect(svc.getCached().parsed.replyStyle['语气']).toBe('再次保存')

    // 磁盘上也应一致
    const onDisk = fs.readFileSync(agentMdPath, 'utf8')
    expect(onDisk).toContain('再次保存')

    svc.stopWatching()
  })
})
