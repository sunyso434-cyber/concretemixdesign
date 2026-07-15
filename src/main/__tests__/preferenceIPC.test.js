// 模拟 electron 的 ipcMain.handle 捕获所有注册的 channel
const mockHandlers = new Map()
jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel, fn) => mockHandlers.set(channel, fn),
    on: jest.fn()
  },
  shell: { openPath: jest.fn() }
}))

const fs = require('fs')
const os = require('os')
const path = require('path')
const { PreferenceSuggestion, sequelize } = require('../db/database')

// 准备临时 agent.md + agentMdService
const tmpFile = path.join(os.tmpdir(), `agent-md-preftest-${Date.now()}.md`)
const { AgentMdService } = require('../agent/agentMd/AgentMdService')
const svc = new AgentMdService({ path: tmpFile })

// 注入 svc 到 agentMd 模块
jest.doMock('../agent/agentMd', () => ({
  getInstance: () => svc,
  init: () => svc,
  agentMdPath: tmpFile
}))

// 注入 SuggestionStore
const { getSuggestionStore } = require('../agent/preferences')
const store = getSuggestionStore()
let firstSuggestionId

// 注册 handler
const { registerAgentHandlers } = require('../ipcHandlers/agentHandler')
registerAgentHandlers()

// v2 adapter: read sections as v1-compatible object + write-back to v2 sections
function v2ToV1Proxy(parsed) {
  const sections = parsed.sections || []
  function ensureSection(title) {
    let sec = sections.find(s => s.title === title)
    if (!sec) { sec = { title, subSections: [] }; sections.push(sec) }
    return sec
  }
  function ensureSubSection(sectionTitle, subTitle) {
    const sec = ensureSection(sectionTitle)
    let sub = sec.subSections.find(s => s.title === subTitle)
    if (!sub) { sub = { title: subTitle, items: [], rawText: '' }; sec.subSections.push(sub) }
    return sub
  }
  const _prefs = {}
  const bizSection = sections.find(s => s.title === '业务规则')
  const subs = (bizSection?.subSections) || []
  let _materials = (subs.find(s => s.title === '材料')?.items || []).map(v => ({ category: '', dimension: '', value: v }))
  const methodSub = subs.find(s => s.title === '计算方法')
  let _method = methodSub?.items?.[0] || null
  Object.defineProperty(_prefs, 'materials', {
    get() { return _materials },
    set(v) {
      _materials = v
      const sub = ensureSubSection('业务规则', '材料')
      sub.items = (v || []).map(m => [m.category, m.dimension, m.value].filter(Boolean).join(' '))
    },
    enumerable: true, configurable: true
  })
  Object.defineProperty(_prefs, 'method', {
    get() { return _method },
    set(v) {
      _method = v
      if (v) { const sub = ensureSubSection('业务规则', '计算方法'); sub.items = [v] }
    },
    enumerable: true, configurable: true
  })
  return {
    version: parsed.version,
    replyStyle: {},
    get professionalPrefs() { return _prefs },
    set professionalPrefs(v) {
      if (!v) return
      _prefs.materials = v.materials || []
      _prefs.method = v.method || null
    },
    get ignoredSuggestionTypes() {
      const bizSection = sections.find(s => s.title === '业务规则')
      const _subs = (bizSection?.subSections) || []
      const ignoredSub = _subs.find(s => s.title === '忽略的建议类型')
      return ignoredSub?.items || []
    },
    set ignoredSuggestionTypes(v) {
      const sub = ensureSubSection('业务规则', '忽略的建议类型')
      sub.items = v || []
    },
    get workflow() { return sections.filter(s => s.title !== '业务规则' && s.title !== '回复规范').map(s => s.title) },
    get customKnowledge() { return [] },
    get unknownSections() { return {} }
  }
}

// 顶层 saveToFile 现为 async（Promise 串行队列），需在 beforeAll 中 await
// 确保后续测试读到的 cached 是已写入的状态
beforeAll(async () => {
  await sequelize.sync()
  await PreferenceSuggestion.destroy({ truncate: true })
  const firstSuggestion = await store.add({
    id: 'sugg-1',
    type: 'material_vendor',
    title: 'test',
    proposedYaml: { category: '水泥', dimension: '厂家', value: '拉法基' },
    reason: 'r',
    confidence: 1.0,
    createdAt: new Date(),
    status: 'pending'
  })
  firstSuggestionId = firstSuggestion.id
  await svc.saveToFile('---\nversion: 2\n---\n\n# 我的智能助手规则\n\n## 专业偏好\n\n```yaml\nmaterials: []\nmethod: null\n```\n')
})

describe('7 个偏好 IPC channel', () => {
  test('agent:suggestions:list 应返回 pending 列表', async () => {
    const handler = mockHandlers.get('agent:suggestions:list')
    expect(handler).toBeDefined()
    const result = await handler({})
    expect(result.success).toBe(true)
    expect(result.suggestions).toHaveLength(1)
  })

  test('agent:suggestions:accept 应合并到 materials 并返回', async () => {
    const handler = mockHandlers.get('agent:suggestions:accept')
    const result = await handler({}, { id: firstSuggestionId })
    expect(result.success).toBe(true)
    expect(result.newMaterials).toContainEqual({
      category: '水泥', dimension: '厂家', value: '拉法基'
    })
  })

  test('agent:suggestions:dismiss 应从列表移除', async () => {
    const suggestion = await store.add({
      id: 'sugg-2', type: 'material_vendor', title: 't',
      proposedYaml: { category: '水泥', dimension: '厂家', value: '海螺' },
      reason: 'r', confidence: 1.0, createdAt: new Date(), status: 'pending'
    })
    const handler = mockHandlers.get('agent:suggestions:dismiss')
    const result = await handler({}, { id: suggestion.id })
    expect(result.success).toBe(true)
  })

  test('agent:suggestions:blacklist 应写入 ignoredSuggestionTypes', async () => {
    const handler = mockHandlers.get('agent:suggestions:blacklist')
    const suggestion = await store.add({
      id: 'sugg-3', type: 'method_preference', title: 't',
      proposedYaml: { method: '质量法' },
      reason: 'r', confidence: 1.0, createdAt: new Date(), status: 'pending'
    })
    const result = await handler({}, { id: suggestion.id, type: 'method_preference' })
    expect(result.success).toBe(true)
    const cached = svc.getCached()
    expect(v2ToV1Proxy(cached.parsed).ignoredSuggestionTypes).toContain('method_preference')
  })

  test('agent:preferences:get 应返回当前偏好', async () => {
    const handler = mockHandlers.get('agent:preferences:get')
    const result = await handler({})
    expect(result.materials).toBeDefined()
    expect(result.method).toBeDefined()
  })

  test('agent:preferences:upsert 应写回 agent.md', async () => {
    const handler = mockHandlers.get('agent:preferences:upsert')
    const result = await handler({}, {
      materials: [{ category: '细骨料', dimension: '性能', metric: '细度模数', value: 2.7 }],
      method: '体积法'
    })
    expect(result.success).toBe(true)
    const cached = svc.getCached()
    const p = v2ToV1Proxy(cached.parsed)
    // v2 适配：materials 以 join string 存回 section items，proxy 还原为 {category:'',dimension:'',value: string}
    expect(p.professionalPrefs.materials).toContainEqual({
      category: '', dimension: '', value: '细骨料 性能 2.7'
    })
  })

  test('agent:preferences:delete 应删除指定 index 的偏好', async () => {
    const handler = mockHandlers.get('agent:preferences:delete')
    const result = await handler({}, { index: 0 })
    expect(result.success).toBe(true)
    const cached = svc.getCached()
    expect(v2ToV1Proxy(cached.parsed).professionalPrefs.materials).toEqual([])
  })

  test('所有 channel 抛错时返回 success:false + error', async () => {
    const handler = mockHandlers.get('agent:suggestions:accept')
    // 传不存在的 id
    const result = await handler({}, { id: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  // ===== v4.6.x agent:rules:upsert 修复方案 A：渲染进程整体保存 rules =====

  test('agent:rules:upsert 应接收 v2 sections 对象并写盘', async () => {
    const handler = mockHandlers.get('agent:rules:upsert')
    expect(handler).toBeDefined()

    const rules = {
      version: 2,
      sections: [
        { title: '回复规范', subSections: [{ title: null, items: ['语气：严谨专业', '称呼：老板'] }] },
        { title: '业务规则', subSections: [
          { title: '材料', items: ['掺合料 种类 矿粉'] },
          { title: '计算方法', items: ['质量法'] }
        ]},
        { title: '工作流程', subSections: [{ title: null, items: ['先确认强度等级'] }] }
      ]
    }
    const result = await handler({}, { rules })
    expect(result.success).toBe(true)
    // 主进程返回最新 cached
    expect(result.data).toBeDefined()
    const p = v2ToV1Proxy(result.data.parsed)
    expect(p.professionalPrefs.materials).toContainEqual({
      category: '', dimension: '', value: '掺合料 种类 矿粉'
    })
    expect(p.professionalPrefs.method).toBe('质量法')
    expect(p.replyStyle).toEqual({})
    // 写盘内容必须是合法 markdown items（不再出 YAML materials: 头丢失）
    const onDisk = fs.readFileSync(tmpFile, 'utf8')
    expect(onDisk).toContain('- 掺合料 种类 矿粉')
    expect(onDisk).toContain('- 质量法')
  })

  test('agent:rules:upsert 参数缺失时返回 success:false', async () => {
    const handler = mockHandlers.get('agent:rules:upsert')
    const result = await handler({}, { rules: null })
    expect(result.success).toBe(false)
    expect(result.error).toContain('rules')
  })

  test('agent:rules:upsert 即使只含 method 也能正确写入', async () => {
    const handler = mockHandlers.get('agent:rules:upsert')
    const rules = {
      version: 2,
      sections: [
        { title: '业务规则', subSections: [
          { title: '计算方法', items: ['体积法'] }
        ]}
      ]
    }
    const result = await handler({}, { rules })
    expect(result.success).toBe(true)
    expect(v2ToV1Proxy(result.data.parsed).professionalPrefs.method).toBe('体积法')
    // 关键：markdown items 正确写盘，不再出"materials: 头丢失"问题
    const onDisk = fs.readFileSync(tmpFile, 'utf8')
    expect(onDisk).toContain('- 体积法')
  })

  afterAll(async () => {
    await sequelize.close()
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  })
})
