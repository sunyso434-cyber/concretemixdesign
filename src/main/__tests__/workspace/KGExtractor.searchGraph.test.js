// Task 5.4: KGExtractor.searchGraph 单元测试
// 覆盖：BM25 检索 + 别名匹配 + 三元组展开 + 空结果 + 不调 LLM
const fs = require('fs')
const path = require('path')
const os = require('os')
const { KGExtractor } = require('../../workspace/KGExtractor')

describe('KGExtractor.searchGraph (Task 5.4)', () => {
  const wsPath = path.join(os.tmpdir(), 'kg-query-test-' + Date.now())

  beforeAll(() => {
    fs.mkdirSync(path.join(wsPath, 'wiki', 'kg'), { recursive: true })
    // 准备 fixture graph.json
    const fixture = {
      version: 1, workspacePath: wsPath.replace(/\\/g, '/'),
      entities: {
        'a1b2c3d4e5f6g7h8': { id: 'a1b2c3d4e5f6g7h8', name: '硅灰', type: 'Material', aliases: ['硅粉'] },
        'b2c3d4e5f6g7h8i9': { id: 'b2c3d4e5f6g7h8i9', name: '28d 抗压强度', type: 'Property', aliases: [] }
      },
      relations: [
        {
          subjectId: 'a1b2c3d4e5f6g7h8',
          predicate: 'increases',
          objectId: 'b2c3d4e5f6g7h8i9',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因其高活性 SiO2 与 CH 反应',
          confidence: 0.95,
          source: 'UHPC.pdf'
        }
      ],
      conflicts: [],
      mergeVersion: 1,
      createdAt: '2026-06-17T00:00:00Z',
      updatedAt: '2026-06-17T00:00:00Z',
      lastMergeAt: '2026-06-17T00:00:00Z'
    }
    fs.writeFileSync(path.join(wsPath, 'wiki', 'kg', 'graph.json'), JSON.stringify(fixture, null, 2))
  })

  afterAll(() => {
    fs.rmSync(wsPath, { recursive: true, force: true })
  })

  test('查"硅灰 抗压强度" → 命中硅灰 increases 28d 抗压强度', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const results = await extractor.searchGraph('硅灰 抗压强度', 5, wsPath)
    expect(results).toHaveLength(1)
    expect(results[0].subject.name).toBe('硅灰')
    expect(results[0].predicate).toBe('increases')
    expect(results[0].object.name).toBe('28d 抗压强度')
    expect(results[0].evidence).toContain('28d')
    expect(results[0].source).toBe('UHPC.pdf')
    expect(results[0].confidence).toBe(0.95)
  })

  test('查"硅粉"（别名）→ 也命中', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const results = await extractor.searchGraph('硅粉', 5, wsPath)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.subject.name === '硅灰')).toBe(true)
  })

  test('查无关词 → 空结果', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const results = await extractor.searchGraph('xyz不存在', 5, wsPath)
    expect(results).toEqual([])
  })

  test('不调 LLM（纯 BM25 检索）', async () => {
    const llmSpy = jest.fn()
    const extractor = new KGExtractor({ llmClient: { invoke: llmSpy } })
    await extractor.searchGraph('硅灰', 5, wsPath)
    expect(llmSpy).not.toHaveBeenCalled()
  })

  test('空图 → 返回空数组（不抛）', async () => {
    const emptyWs = path.join(os.tmpdir(), 'kg-empty-test-' + Date.now())
    fs.mkdirSync(path.join(emptyWs, 'wiki', 'kg'), { recursive: true })
    // 不写 graph.json → loadGraph 返回空图
    const extractor = new KGExtractor({ llmClient: null })
    const results = await extractor.searchGraph('硅灰', 5, emptyWs)
    expect(results).toEqual([])
    fs.rmSync(emptyWs, { recursive: true, force: true })
  })

  test('topK 限制返回条数', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const results = await extractor.searchGraph('硅灰', 1, wsPath)
    expect(results.length).toBeLessThanOrEqual(1)
  })
})
