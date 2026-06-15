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
svc.saveToFile('---\nversion: 2\n---\n\n# 我的智能助手规则\n\n## 专业偏好\n\n```yaml\nmaterials: []\nmethod: null\n```\n')

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

  afterAll(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  })
})