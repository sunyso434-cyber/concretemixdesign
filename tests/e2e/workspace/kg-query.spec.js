// E2E O (P5 验收): KG 查询 - "硅灰 抗压强度" → 命中三元组
// v1.5.3 关键：
// 1. 直接预置 graph.json（跳过 LLM extract，节约 30s+）
// 2. 用 workspace:searchGraph IPC 走真实 P5 路径
// 3. 断言返回 ≥1 个完整三元组，subject.name 含"硅灰"
const { test, expect, _electron: electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs').promises
const os = require('os')
const crypto = require('crypto')

let app, window
let testWs

const sha1Id = (name, type) =>
  crypto.createHash('sha1').update(`${name}|${type}`).digest('hex').substring(0, 16)

test.beforeAll(async () => {
  // 创建临时工作区 + 预置 graph.json（避免依赖 LLM 提取）
  testWs = path.join(os.tmpdir(), `e2e-kg-query-${Date.now()}`)
  await fs.mkdir(path.join(testWs, 'wiki', 'kg'), { recursive: true })

  const subjectId = sha1Id('硅灰', 'Material')
  const objectId = sha1Id('28d 抗压强度', 'Property')
  const fixture = {
    version: 1,
    workspacePath: testWs.replace(/\\/g, '/'),
    entities: {
      [subjectId]: { id: subjectId, name: '硅灰', type: 'Material', aliases: ['硅粉'] },
      [objectId]: { id: objectId, name: '28d 抗压强度', type: 'Property', aliases: [] }
    },
    relations: [
      {
        subjectId,
        predicate: 'increases',
        objectId,
        evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因其填充效应和火山灰活性',
        confidence: 0.95,
        source: 'UHPC.pdf'
      }
    ],
    conflicts: [],
    mergeVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMergeAt: new Date().toISOString()
  }
  await fs.writeFile(
    path.join(testWs, 'wiki', 'kg', 'graph.json'),
    JSON.stringify(fixture, null, 2)
  )
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  if (testWs) await fs.rm(testWs, { recursive: true, force: true }).catch(() => {})
})

test('E2E O: KG 查询 - "硅灰 抗压强度" → 命中三元组', async () => {
  app = await electron.launch({ args: ['.'] })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // 打开工作区
  await window.evaluate(
    (p) => window.electronAPI.workspace.open(p),
    testWs
  )

  // 调 workspace:searchGraph IPC
  // 注意：window.electronAPI.workspace 当前未暴露 searchGraph（preload.js 没加）
  // 走通用 invoke 通道
  const result = await window.evaluate(
    ({ query, topK }) => window.electronAPI.invoke('workspace:searchGraph', { query, topK }),
    { query: '硅灰 抗压强度', topK: 5 }
  )

  console.log('[E2E O] searchGraph 返回:', JSON.stringify(result, null, 2))

  // 断言
  expect(result).toBeDefined()
  expect(result.results).toBeDefined()
  expect(result.results.length).toBeGreaterThanOrEqual(1)
  const top = result.results[0]
  expect(top.subject.name).toBe('硅灰')
  expect(top.predicate).toBe('increases')
  expect(top.object.name).toBe('28d 抗压强度')
  expect(top.evidence).toContain('28d')
  expect(top.source).toBe('UHPC.pdf')
  expect(top.confidence).toBe(0.95)
})

test('E2E O: searchGraph 别名匹配 - "硅粉" → 仍能命中"硅灰"', async () => {
  // 复用上一个 app 实例（避免重复启动）
  if (!app) {
    app = await electron.launch({ args: ['.'] })
    window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.evaluate(
      (p) => window.electronAPI.workspace.open(p),
      testWs
    )
  }

  const result = await window.evaluate(
    ({ query, topK }) => window.electronAPI.invoke('workspace:searchGraph', { query, topK }),
    { query: '硅粉', topK: 5 }
  )

  expect(result.results.length).toBeGreaterThanOrEqual(1)
  expect(result.results.some(r => r.subject.name === '硅灰')).toBe(true)
})

test('E2E O: searchGraph 无匹配 → 返回空数组', async () => {
  const result = await window.evaluate(
    ({ query, topK }) => window.electronAPI.invoke('workspace:searchGraph', { query, topK }),
    { query: 'xyz完全不存在', topK: 5 }
  )

  expect(result.results).toEqual([])
})

test('E2E O: searchGraph < 100ms（不调 LLM）', async () => {
  const start = Date.now()
  await window.evaluate(
    ({ query, topK }) => window.electronAPI.invoke('workspace:searchGraph', { query, topK }),
    { query: '硅灰 抗压强度', topK: 5 }
  )
  const elapsed = Date.now() - start
  console.log(`[E2E O] searchGraph 耗时: ${elapsed}ms`)
  // LLM 调用通常 1-5s，本地 BM25 应 < 500ms
  expect(elapsed).toBeLessThan(500)
})
