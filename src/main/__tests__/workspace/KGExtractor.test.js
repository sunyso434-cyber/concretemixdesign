const path = require('path')
const os = require('os')
const fs = require('fs').promises
const fsSync = require('fs')
const { KGExtractor } = require('../../workspace/KGExtractor')
const schema = require('../../workspace/kg-schema.json')

const makeTempDir = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix))

describe('KGExtractor.extract', () => {
  test('LLM mock 返回标准三元组', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        entities: [
          { name: '硅灰', type: 'Material' },
          { name: '28d 抗压强度', type: 'Property' }
        ],
        relations: [
          { subject: '硅灰', predicate: 'increases', object: '28d 抗压强度',
            evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因其填充效应和火山灰活性',
            confidence: 0.95 }
        ]
      }))
    }
    const extractor = new KGExtractor({ llmClient: mockLLM, schema })
    const result = await extractor.extract('硅灰能显著提高混凝土的 28d 抗压强度，因其填充效应和火山灰活性', 'test.pdf')
    expect(result.quality).toBe('high')
    expect(result.entities).toHaveLength(2)
    expect(result.relations).toHaveLength(1)
    expect(result.entities[0].id).toMatch(/^[a-f0-9]{16}$/)
    expect(result.relations[0].subjectId).toMatch(/^[a-f0-9]{16}$/)
    // Crit-5: relation 的 subjectId 与 entities 数组里的 id 一致
    expect(result.relations[0].subjectId).toBe(result.entities[0].id)
  })

  test('evidence < 30 字的 relation 被剔除（Crit-3）', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        entities: [
          { name: '硅灰', type: 'Material' },
          { name: '强度', type: 'Property' }
        ],
        relations: [
          { subject: '硅灰', predicate: 'increases', object: '强度', evidence: '太短', confidence: 0.9 }
        ]
      }))
    }
    const extractor = new KGExtractor({ llmClient: mockLLM, schema: {} })
    const result = await extractor.extract('text', 'test.pdf')
    expect(result.relations).toHaveLength(0)
    expect(result.droppedRelations).toHaveLength(1)
    expect(result.droppedRelations[0].reason).toBe('evidence-too-short')
  })

  test('relation 中 subject/object 在 entities 字典里查不到 → 跳过该 relation（Crit-5）', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        entities: [{ name: '硅灰', type: 'Material' }],
        relations: [
          { subject: '硅灰', predicate: 'increases', object: '不存在的实体',
            evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因其填充效应',
            confidence: 0.9 }
        ]
      }))
    }
    const extractor = new KGExtractor({ llmClient: mockLLM, schema: {} })
    const result = await extractor.extract('text', 'test.pdf')
    expect(result.relations).toHaveLength(0)
    expect(result.droppedRelations[0].reason).toBe('entity-not-found')
  })

  test('LLM 失败 → quality: low + 不抛', async () => {
    const mockLLM = { invoke: jest.fn().mockRejectedValue(new Error('rate limit')) }
    const extractor = new KGExtractor({ llmClient: mockLLM, schema: {} })
    const result = await extractor.extract('text', 'test.pdf')
    expect(result.quality).toBe('low')
    expect(result.entities).toEqual([])
    expect(result.error.code).toBe('KG_EXTRACT_FAIL')
  })

  test('LLM 返回非 JSON → KG_EXTRACT_FAIL', async () => {
    const mockLLM = { invoke: jest.fn().mockResolvedValue('not json') }
    const extractor = new KGExtractor({ llmClient: mockLLM, schema: {} })
    const result = await extractor.extract('text', 'test.pdf')
    expect(result.quality).toBe('low')
    expect(result.error.code).toBe('KG_EXTRACT_FAIL')
  })

  test('无 LLM client → 返回 quality: low', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const result = await extractor.extract('text', 'test.pdf')
    expect(result.quality).toBe('low')
    expect(result.entities).toEqual([])
  })
})

describe('KGExtractor.loadGraph + saveGraph', () => {
  test('loadGraph 不存在 → 返回空图', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const g = await extractor.loadGraph(path.join(os.tmpdir(), 'nonexistent-ws-' + Date.now()))
    expect(g.version).toBe(1)
    expect(g.entities).toEqual({})
    expect(g.relations).toEqual([])
  })

  test('saveGraph 原子写 + 读回一致', async () => {
    const p = await makeTempDir('kg-test-')
    const extractor = new KGExtractor({ llmClient: null })
    const g = {
      version: 1, workspacePath: p, entities: { x: { id: 'x', name: '硅灰', type: 'Material' } },
      relations: [], conflicts: [], mergeVersion: 1, createdAt: '2026-06-17T00:00:00Z',
      updatedAt: '2026-06-17T00:00:00Z', lastMergeAt: '2026-06-17T00:00:00Z'
    }
    await extractor.saveGraph(p, g)
    const loaded = await extractor.loadGraph(p)
    expect(loaded.entities.x.name).toBe('硅灰')
    await fs.rm(p, { recursive: true, force: true })
  })

  test('saveGraph 原子写：无残留 .tmp 文件', async () => {
    const p = await makeTempDir('kg-atomic-')
    const extractor = new KGExtractor({ llmClient: null })
    const g = {
      version: 1, workspacePath: p, entities: {}, relations: [], conflicts: [],
      mergeVersion: 1, createdAt: '2026-06-17T00:00:00Z',
      updatedAt: '2026-06-17T00:00:00Z', lastMergeAt: '2026-06-17T00:00:00Z'
    }
    await extractor.saveGraph(p, g)
    const kgDir = path.join(p, 'wiki', 'kg')
    const files = await fs.readdir(kgDir)
    expect(files).toEqual(['graph.json'])
    await fs.rm(p, { recursive: true, force: true })
  })

  test('loadGraph 损坏 → 抛 KG_GRAPH_CORRUPT', async () => {
    const p = await makeTempDir('kg-corrupt-')
    await fs.mkdir(path.join(p, 'wiki', 'kg'), { recursive: true })
    await fs.writeFile(path.join(p, 'wiki', 'kg', 'graph.json'), '{not valid json', 'utf-8')
    const extractor = new KGExtractor({ llmClient: null })
    await expect(extractor.loadGraph(p)).rejects.toMatchObject({ code: 'KG_GRAPH_CORRUPT' })
    await fs.rm(p, { recursive: true, force: true })
  })
})

describe('KGExtractor.compact', () => {
  test('合并重复实体（同名+同类型）→ relations 引用指向合并后 id', () => {
    const extractor = new KGExtractor({ llmClient: null })
    const graph = {
      version: 1,
      entities: {
        a1: { id: 'a1', name: '硅灰', type: 'Material', aliases: [] },
        a2: { id: 'a2', name: '硅灰', type: 'Material', aliases: ['硅粉'] }
      },
      relations: [
        { subjectId: 'a1', predicate: 'increases', objectId: 'b1',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度', confidence: 0.9, source: 'old.pdf' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    const compacted = extractor.compact(graph)
    expect(Object.keys(compacted.entities)).toHaveLength(1)
    // 保留 a1（先到的），aliases 合并
    expect(compacted.entities.a1.aliases).toContain('硅粉')
    // relations 仍指向 a1
    expect(compacted.relations[0].subjectId).toBe('a1')
  })

  test('compact 不会合并同名不同类型', () => {
    const extractor = new KGExtractor({ llmClient: null })
    const graph = {
      version: 1,
      entities: {
        a1: { id: 'a1', name: '硅灰', type: 'Material', aliases: [] },
        a2: { id: 'a2', name: '硅灰', type: 'Spec', aliases: [] }
      },
      relations: [],
      conflicts: [],
      mergeVersion: 1
    }
    const compacted = extractor.compact(graph)
    expect(Object.keys(compacted.entities)).toHaveLength(2)
  })

  test('compact 不修改入参图（不可变性）', () => {
    const extractor = new KGExtractor({ llmClient: null })
    const graph = {
      version: 1,
      entities: {
        a1: { id: 'a1', name: '硅灰', type: 'Material', aliases: [] },
        a2: { id: 'a2', name: '硅灰', type: 'Material', aliases: [] }
      },
      relations: [],
      conflicts: [],
      mergeVersion: 1
    }
    extractor.compact(graph)
    expect(Object.keys(graph.entities)).toHaveLength(2)
  })
})
