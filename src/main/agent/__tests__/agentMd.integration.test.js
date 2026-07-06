const fs = require('fs')
const path = require('path')
const os = require('os')
const { AgentMdService } = require('../agentMd/AgentMdService')
const { buildSystemPrompt } = require('../systemPromptBuilder')

// v2 adapter: read sections as v1-compatible object (empty defaults for migration)
function v2ToV1Proxy(parsed) {
  const sections = parsed.sections || []
  const bizSection = sections.find(s => s.title === '业务规则')
  const subs = (bizSection?.subSections) || []
  return {
    version: parsed.version,
    replyStyle: {},
    professionalPrefs: {
      materials: (subs.find(s => s.title === '材料')?.items || []).map(v => ({
        category: '', dimension: '', value: v
      })),
      method: null
    },
    ignoredSuggestionTypes: [],
    workflow: sections.filter(s => s.title !== '业务规则' && s.title !== '回复规范').map(s => s.title),
    customKnowledge: [],
    unknownSections: {}
  }
}

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

    // 3. 注入 system prompt（v2 传 userRulesMarkdown 而非 agentMdRules）
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: [],
      userRulesMarkdown: svc2.getFormattedRules()
    })

    expect(prompt).toContain('非常专业')
    expect(prompt).toContain('王工')
    expect(prompt).toContain('确认工程部位')
  })

  test('外部修改后 chokidar 触发 → 缓存更新', done => {
    // 先写一份初始内容（v2：用 proxy 可读的 业务规则>材料 格式）
    const initial = '## 业务规则\n\n### 材料\n- 初始材料'
    fs.writeFileSync(agentMdPath, initial, 'utf8')
    const svc = new AgentMdService({ path: agentMdPath })
    svc.init()

    setTimeout(() => {
      fs.writeFileSync(agentMdPath, '## 业务规则\n\n### 材料\n- 外部修改材料', 'utf8')
      setTimeout(() => {
        const p = v2ToV1Proxy(svc.getCached().parsed)
        expect(p.professionalPrefs.materials).toEqual([
          { category: '', dimension: '', value: '外部修改材料' }
        ])
        svc.stopWatching()
        done()
      }, 800)
    }, 200)
  }, 10000)

  test('保存后缓存一致性（自身 save 后 cache 立即反映新值）', async () => {
    const svc = new AgentMdService({ path: agentMdPath })
    svc.init() // init 内部先 loadFromFile（空文件）+ startWatching

    // 自身 save 后缓存应立即更新（不等 chokidar 回调）
    await svc.saveToFile('## 业务规则\n\n### 材料\n- 自身保存材料')
    const p1 = v2ToV1Proxy(svc.getCached().parsed)
    expect(p1.professionalPrefs.materials).toEqual([
      { category: '', dimension: '', value: '自身保存材料' }
    ])

    // 再次 save 也应一致
    await svc.saveToFile('## 业务规则\n\n### 材料\n- 再次保存材料')
    const p2 = v2ToV1Proxy(svc.getCached().parsed)
    expect(p2.professionalPrefs.materials).toEqual([
      { category: '', dimension: '', value: '再次保存材料' }
    ])

    // 磁盘上也应一致
    const onDisk = fs.readFileSync(agentMdPath, 'utf8')
    expect(onDisk).toContain('再次保存材料')

    svc.stopWatching()
  })
})
