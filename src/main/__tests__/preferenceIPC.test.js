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
store._items = []
store.add({
  id: 'sugg-1',
  type: 'material_vendor',
  title: 'test',
  proposedYaml: { category: '水泥', dimension: '厂家', value: '拉法基' },
  reason: 'r',
  confidence: 1.0,
  createdAt: new Date(),
  status: 'pending'
})

// 注册 handler
const { registerAgentHandlers } = require('../ipcHandlers/agentHandler')
registerAgentHandlers()

// 顶层 saveToFile 现为 async（Promise 串行队列），需在 beforeAll 中 await
// 确保后续测试读到的 cached 是已写入的状态
beforeAll(async () => {
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
    const result = await handler({}, { id: 'sugg-1' })
    expect(result.success).toBe(true)
    expect(result.newMaterials).toContainEqual({
      category: '水泥', dimension: '厂家', value: '拉法基'
    })
  })

  test('agent:suggestions:dismiss 应从列表移除', async () => {
    store.add({
      id: 'sugg-2', type: 'material_vendor', title: 't',
      proposedYaml: { category: '水泥', dimension: '厂家', value: '海螺' },
      reason: 'r', confidence: 1.0, createdAt: new Date(), status: 'pending'
    })
    const handler = mockHandlers.get('agent:suggestions:dismiss')
    const result = await handler({}, { id: 'sugg-2' })
    expect(result.success).toBe(true)
  })

  test('agent:suggestions:blacklist 应写入 ignoredSuggestionTypes', async () => {
    const handler = mockHandlers.get('agent:suggestions:blacklist')
    store.add({
      id: 'sugg-3', type: 'method_preference', title: 't',
      proposedYaml: { method: '质量法' },
      reason: 'r', confidence: 1.0, createdAt: new Date(), status: 'pending'
    })
    const result = await handler({}, { id: 'sugg-3', type: 'method_preference' })
    expect(result.success).toBe(true)
    const cached = svc.getCached()
    expect(cached.parsed.ignoredSuggestionTypes).toContain('method_preference')
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
    expect(cached.parsed.professionalPrefs.materials).toContainEqual({
      category: '细骨料', dimension: '性能', metric: '细度模数', value: 2.7
    })
  })

  test('agent:preferences:delete 应删除指定 index 的偏好', async () => {
    const handler = mockHandlers.get('agent:preferences:delete')
    const result = await handler({}, { index: 0 })
    expect(result.success).toBe(true)
    const cached = svc.getCached()
    expect(cached.parsed.professionalPrefs.materials).toEqual([])
  })

  test('所有 channel 抛错时返回 success:false + error', async () => {
    const handler = mockHandlers.get('agent:suggestions:accept')
    // 传不存在的 id
    const result = await handler({}, { id: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  // ===== v4.6.x agent:rules:upsert 修复方案 A：渲染进程整体保存 rules =====

  test('agent:rules:upsert 应接收结构化 rules 对象并写盘', async () => {
    const handler = mockHandlers.get('agent:rules:upsert')
    expect(handler).toBeDefined()

    const rules = {
      version: 2,
      replyStyle: { '语气': '严谨专业', '称呼': '老板' },
      professionalPrefs: {
        materials: [
          { category: '掺合料', dimension: '种类', value: '矿粉' }
        ],
        method: '质量法'
      },
      ignoredSuggestionTypes: [],
      workflow: ['先确认强度等级'],
      customKnowledge: ['公司规范水胶比不超过 0.45'],
      unknownSections: {}
    }
    const result = await handler({}, { rules })
    expect(result.success).toBe(true)
    // 主进程返回最新 cached
    expect(result.data).toBeDefined()
    expect(result.data.parsed.professionalPrefs.materials).toContainEqual({
      category: '掺合料', dimension: '种类', value: '矿粉'
    })
    expect(result.data.parsed.professionalPrefs.method).toBe('质量法')
    expect(result.data.parsed.replyStyle['称呼']).toBe('老板')
    // 写盘内容必须是合法 YAML（关键回归断言：保证不再出现"materials: 头丢失"那种崩溃）
    const onDisk = fs.readFileSync(tmpFile, 'utf8')
    expect(onDisk).toContain('materials:')
    expect(onDisk).toContain('method: 质量法')
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
      replyStyle: {},
      professionalPrefs: { materials: [], method: '体积法' },
      ignoredSuggestionTypes: [],
      workflow: [],
      customKnowledge: [],
      unknownSections: {}
    }
    const result = await handler({}, { rules })
    expect(result.success).toBe(true)
    expect(result.data.parsed.professionalPrefs.method).toBe('体积法')
    // 关键：YAML 解析必须成功，不能再现"end of the stream or a document separator is expected"
    const onDisk = fs.readFileSync(tmpFile, 'utf8')
    const yaml = require('js-yaml')
    const codeBlockMatch = onDisk.match(/```yaml\n([\s\S]*?)\n```/)
    expect(codeBlockMatch).toBeTruthy()
    expect(() => yaml.load(codeBlockMatch[1])).not.toThrow()
  })

  afterAll(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  })
})