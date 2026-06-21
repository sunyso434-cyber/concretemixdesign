/**
 * P5 E2E 场景 M/N/O 集成测试
 * Task 5.5a/b/c (P5 第 5 个 task)
 *
 * 设计目标：
 * - E2E M: KG 论文级提取
 *   - 5 篇真实混凝土技术文档（每篇 ≥2 entities, ≥1 relation）
 *   - mock LLM 按内容返回三元组 → KGExtractor.extract
 *   - mergeInto 合并 → 验证累计 ≥10 entities + ≥8 relations + ≥3 relation type
 *
 * - E2E N: KG 合并冲突检测
 *   - 3 篇文档：2 篇说「硅灰 increases 强度」 + 1 篇说「硅灰 decreases 强度」
 *   - mergeInto → 验证 conflicting_relation 冲突被检测 + conflicts 列表非空
 *
 * - E2E O: KG 查询验证
 *   - 准备 fixture graph.json（硅灰 → 28d 抗压强度）
 *   - searchGraph("硅灰 抗压强度") → < 100ms 返回 ≥1 个三元组
 *
 * 测试策略：
 * - 真 KGExtractor + 真 kg-merge + 真 searchGraph
 * - mock LLM 客户端（不真调，按内容返回固定三元组）
 * - 每个测试用独立 tmp 目录（afterEach 清理）
 * - 不引入新依赖
 */
const path = require('path')
const fs = require('fs').promises
const os = require('os')

const { KGExtractor } = require('../../workspace/KGExtractor')
const { mergeInto } = require('../../workspace/kg-merge')
const schema = require('../../workspace/kg-schema.json')

// ==================== 工具 ====================

async function mkTmpDir(label) {
  const id = `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const p = path.join(os.tmpdir(), id)
  await fs.mkdir(p, { recursive: true })
  return p
}

async function rmTmpDir(p) {
  await fs.rm(p, { recursive: true, force: true }).catch(() => {})
}

/**
 * 把"按文档内容返回三元组"的策略包装成 mock LLM。
 * 每个 pattern 含一个 sourceFile（精确匹配 prompt 中的 source 字段），
 * 用于让 5 篇不同文档返回不同三元组。
 * @param {Array<{sourceFile: string, entities: Array, relations: Array}>} patterns
 */
function makeMockLLM(patterns) {
  return {
    invoke: jest.fn(async (prompt) => {
      // prompt 形如 "...\n文本：xxx\n\nSchema：..."
      // 我们把 sourceFile 注入到 LLM 输出前的内容中（模拟 prompt 包含文档引用）
      for (const p of patterns) {
        if (prompt.includes(`文本：${p.sourceFile}`) || prompt.includes(p.sourceFile)) {
          return JSON.stringify({ entities: p.entities, relations: p.relations })
        }
      }
      return JSON.stringify({ entities: [], relations: [] })
    })
  }
}

/** 等价 ≥30 字的 evidence 片段 */
function ev(s) {
  // pad 到 ≥30 字符
  if (s.length >= 30) return s
  return s + '，详细实验数据见论文第3节表1。'
}

// ==================== E2E M: KG 论文级提取 ====================

describe('P5 E2E M: KG 论文级提取（≥10 entities + ≥8 relations + ≥3 relation type）', () => {
  let wsPath

  beforeEach(async () => {
    wsPath = await mkTmpDir('p5-e2e-m')
  })

  afterEach(async () => {
    await rmTmpDir(wsPath)
  })

  test('5 篇混凝土技术文档 → extract + mergeInto → 累计 ≥10 entities + ≥8 relations + ≥3 relation type', async () => {
    // 1) 准备 5 篇文档的"内容 → 三元组"映射
    // 注意：mockLLM 按 sourceFile 精确匹配（不同文档不同 content 走不同 pattern）
    const mockLLM = makeMockLLM([
      {
        // 文档 1：UHPC 论文
        sourceFile: 'doc1-uhpc.md',
        entities: [
          { name: '硅灰', type: 'Material' },
          { name: '28d 抗压强度', type: 'Property' },
          { name: 'UHPC', type: 'Spec' },
          { name: '流动性', type: 'Property' }
        ],
        relations: [
          { subject: '硅灰', predicate: 'increases', object: '28d 抗压强度',
            evidence: ev('硅灰能显著提高 UHPC 的 28d 抗压强度，因其高活性 SiO2 与 CH 反应'), confidence: 0.95 },
          { subject: '硅灰', predicate: 'decreases', object: '流动性',
            evidence: ev('硅灰比表面积大，需水量高，会显著降低混凝土流动性'), confidence: 0.9 }
        ]
      },
      {
        // 文档 2：水胶比
        sourceFile: 'doc2-waterbinder.md',
        entities: [
          { name: '水胶比', type: 'Property' },
          { name: '抗压强度', type: 'Property' },
          { name: '脆性', type: 'Property' }
        ],
        relations: [
          { subject: '水胶比', predicate: 'correlatesWith', object: '抗压强度',
            evidence: ev('水胶比与混凝土抗压强度呈强负相关，W/B 越低强度越高'), confidence: 0.9 },
          { subject: '水胶比', predicate: 'decreases', object: '脆性',
            evidence: ev('W/B 越低脆性增加，因水化产物更致密，内部缺陷减少'), confidence: 0.7 }
        ]
      },
      {
        // 文档 3：UHPC 钢纤维
        sourceFile: 'doc3-steelfiber.md',
        entities: [
          { name: 'UHPC', type: 'Spec' },
          { name: '钢纤维', type: 'Material' },
          { name: '抗拉强度', type: 'Property' }
        ],
        relations: [
          { subject: 'UHPC', predicate: 'requires', object: '钢纤维',
            evidence: ev('UHPC 必须掺入钢纤维以获得高抗拉强度，常规工艺无法获得 150MPa'), confidence: 0.95 },
          { subject: '钢纤维', predicate: 'increases', object: '抗拉强度',
            evidence: ev('钢纤维的桥接效应显著提高 UHPC 抗拉强度至 7MPa 以上'), confidence: 0.9 }
        ]
      },
      {
        // 文档 4：海砂
        sourceFile: 'doc4-seasand.md',
        entities: [
          { name: '海砂', type: 'Material' },
          { name: '河砂', type: 'Material' },
          { name: '钢筋', type: 'Material' },
          { name: '氯离子腐蚀', type: 'Process' }
        ],
        relations: [
          { subject: '海砂', predicate: 'conflictsWith', object: '河砂',
            evidence: ev('海砂因含氯离子会腐蚀钢筋，与普通河砂在混凝土应用上存在冲突'), confidence: 0.85 },
          { subject: '海砂', predicate: 'causes', object: '氯离子腐蚀',
            evidence: ev('海砂含氯离子，会导致钢筋锈蚀降低结构耐久性'), confidence: 0.9 }
        ]
      },
      {
        // 文档 5：抗冻规范
        sourceFile: 'doc5-gbt50082.md',
        entities: [
          { name: 'GB/T 50082-2009', type: 'Spec' },
          { name: '抗冻融试验', type: 'Process' }
        ],
        relations: [
          { subject: 'GB/T 50082-2009', predicate: 'mentionsIn', object: '抗冻融试验',
            evidence: ev('GB/T 50082-2009 标准规定了混凝土抗冻融试验方法'), confidence: 0.95 }
        ]
      }
    ])

    // 2) 5 篇文档：用纯 extract 路径（不经过 reader，直接传 content）
    //    content 用文件名作关键词（让 mockLLM 能区分）
    const docs = [
      { file: 'doc1-uhpc.md', content: 'doc1-uhpc.md 硅灰能显著提高 UHPC 的 28d 抗压强度，且降低流动性' },
      { file: 'doc2-waterbinder.md', content: 'doc2-waterbinder.md 水胶比与抗压强度呈负相关' },
      { file: 'doc3-steelfiber.md', content: 'doc3-steelfiber.md UHPC 必须掺钢纤维提高抗拉强度' },
      { file: 'doc4-seasand.md', content: 'doc4-seasand.md 海砂与河砂在混凝土应用上存在冲突' },
      { file: 'doc5-gbt50082.md', content: 'doc5-gbt50082.md 规定了抗冻融试验方法' }
    ]

    // 3) 真 KGExtractor.extract + 真 kg-merge.mergeInto
    const extractor = new KGExtractor({ llmClient: mockLLM, schema })
    let graph = null
    for (const d of docs) {
      const result = await extractor.extract(d.content, d.file)
      expect(result.quality).toBe('high')  // 每篇都应成功
      expect(result.entities.length).toBeGreaterThan(0)
      expect(result.relations.length).toBeGreaterThan(0)
      const { graph: merged, conflicts } = mergeInto(graph, result, d.file)
      graph = merged
      // 5 篇合并后不应有冲突（不同主题，无 (s,o) 重复）
      expect(conflicts.filter(c => c.type === 'conflicting_relation')).toEqual([])
    }

    // 4) 验证：≥10 entities
    const entityIds = Object.keys(graph.entities)
    expect(entityIds.length).toBeGreaterThanOrEqual(10)

    // 5) 验证：≥8 relations
    expect(graph.relations.length).toBeGreaterThanOrEqual(8)

    // 6) 验证：≥3 relation type
    const relationTypes = new Set(graph.relations.map(r => r.predicate))
    expect(relationTypes.size).toBeGreaterThanOrEqual(3)
    // 至少有 increases + decreases（最常见）
    expect(relationTypes.has('increases')).toBe(true)
    expect(relationTypes.has('decreases')).toBe(true)

    // 7) 验证：3 种核心 entity type 覆盖（Material/Property/Spec）
    const entityTypes = new Set(Object.values(graph.entities).map(e => e.type))
    expect(entityTypes.has('Material')).toBe(true)
    expect(entityTypes.has('Property')).toBe(true)
    expect(entityTypes.has('Spec')).toBe(true)

    // 8) 保存 graph.json → 再 loadGraph 验证持久化
    await extractor.saveGraph(wsPath, graph)
    const loaded = await extractor.loadGraph(wsPath)
    expect(Object.keys(loaded.entities).length).toBe(entityIds.length)
    expect(loaded.relations.length).toBe(graph.relations.length)
  })
})

// ==================== E2E N: KG 合并冲突检测 ====================

describe('P5 E2E N: KG 合并冲突检测（conflicting_relation）', () => {
  let wsPath

  beforeEach(async () => {
    wsPath = await mkTmpDir('p5-e2e-n')
  })

  afterEach(async () => {
    await rmTmpDir(wsPath)
  })

  test('2 个 increases + 1 个 decreases（相同 s,o 但不同 predicate） → conflicting_relation 触发', async () => {
    // 1) 准备 3 篇文档：
    //    doc1: 硅灰 increases 强度（来源 A）
    //    doc2: 硅灰 increases 强度（来源 B） — 同 predicate，应合并 evidence，不冲突
    //    doc3: 硅灰 decreases 强度（来源 C） — 不同 predicate，应触发 conflicting_relation
    //
    // 直接构造 newTriples（不走 LLM）— E2E N 关键是测 mergeInto 冲突检测逻辑
    //    注：mergeInto 用 sha1(name|type) 生成 id，所以这里直接用 name+type 调 extractor
    //    不用 mock LLM，直接 mergeInto 测试纯合并
    let graph = null
    let allConflicts = []

    // 2) doc1: increases（来源 A）
    const t1 = {
      entities: [
        { id: 'a', name: '硅灰', type: 'Material' },
        { id: 'b', name: '28d 抗压强度', type: 'Property' }
      ],
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '来源A：硅灰在普通混凝土中能显著提高 28d 抗压强度，因火山灰活性',
          confidence: 0.9, source: 'doc1.pdf' }
      ]
    }
    let m = mergeInto(graph, t1, 'doc1.pdf')
    graph = m.graph
    allConflicts = allConflicts.concat(m.conflicts)
    expect(m.conflicts).toEqual([])

    // 3) doc2: increases（来源 B） — 同 predicate，应合并 evidence（无冲突）
    const t2 = {
      entities: [],
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '来源B：硅灰在 UHPC 中能显著提高 28d 抗压强度，因填充效应',
          confidence: 0.95, source: 'doc2.pdf' }
      ]
    }
    m = mergeInto(graph, t2, 'doc2.pdf')
    graph = m.graph
    allConflicts = allConflicts.concat(m.conflicts)
    expect(m.conflicts).toEqual([])
    // 同一三元组保留，但 evidence 合并
    expect(graph.relations.length).toBe(1)
    expect(graph.relations[0].evidence).toContain('来源A')
    expect(graph.relations[0].evidence).toContain('来源B')

    // 4) doc3: decreases（来源 C） — 不同 predicate，应触发 conflicting_relation
    const t3 = {
      entities: [],
      relations: [
        { subjectId: 'a', predicate: 'decreases', objectId: 'b',
          evidence: '来源C：过量硅灰会显著降低后期 28d 抗压强度，因孔隙率上升',
          confidence: 0.7, source: 'doc3.pdf' }
      ]
    }
    m = mergeInto(graph, t3, 'doc3.pdf')
    graph = m.graph
    allConflicts = allConflicts.concat(m.conflicts)

    // 5) 验证：conflicting_relation 冲突被检测
    const conflictingRels = m.conflicts.filter(c => c.type === 'conflicting_relation')
    expect(conflictingRels.length).toBe(1)
    expect(conflictingRels[0].type).toBe('conflicting_relation')
    // 冲突描述含硅灰 + predicate
    expect(conflictingRels[0].description).toContain('increases')
    expect(conflictingRels[0].description).toContain('decreases')
    // occurrences 至少 2 个：旧 + 新
    expect(conflictingRels[0].occurrences.length).toBeGreaterThanOrEqual(2)

    // 6) 验证：graph.conflicts 也写入（持久化）
    expect(graph.conflicts.length).toBeGreaterThanOrEqual(1)
    expect(graph.conflicts.find(c => c.type === 'conflicting_relation')).toBeTruthy()

    // 7) 验证：两条关系都保留（increases 和 decreases）
    expect(graph.relations.length).toBe(2)
    const predicates = graph.relations.map(r => r.predicate).sort()
    expect(predicates).toEqual(['decreases', 'increases'])

    // 8) 持久化 + 再 load 验证
    const extractor = new KGExtractor({ llmClient: null })
    await extractor.saveGraph(wsPath, graph)
    const loaded = await extractor.loadGraph(wsPath)
    expect(loaded.conflicts.length).toBeGreaterThanOrEqual(1)
    expect(loaded.relations.length).toBe(2)
  })

  test('相同 predicate 不算冲突（避免误报）', async () => {
    // 3 篇文档都说 increases，不应触发冲突
    // 注意：每篇 evidence 不同（避免 mergeInto 的去重逻辑跳过合并）
    const mockLLM = {
      invoke: jest.fn(async () => JSON.stringify({
        entities: [
          { name: '硅灰', type: 'Material' },
          { name: '强度', type: 'Property' }
        ],
        relations: [
          { subject: '硅灰', predicate: 'increases', object: '强度',
            evidence: '硅灰能显著提高混凝土强度（不同表述用于测试合并）',
            confidence: 0.9 }
        ]
      }))
    }
    // 直接构造 3 个不同的 newTriples（不依赖 LLM mock 区分），让 mergeInto 测试纯合并逻辑
    const extractor = new KGExtractor({ llmClient: mockLLM, schema })
    let graph = null
    let allConflicts = []

    // 3 个不同来源的相同 predicate 三元组（evidence 不同 → 都能合并）
    const triples = [
      {
        entities: [
          { id: 'a', name: '硅灰', type: 'Material' },
          { id: 'b', name: '强度', type: 'Property' }
        ],
        relations: [
          { subjectId: 'a', predicate: 'increases', objectId: 'b',
            evidence: '来源A：硅灰在普通混凝土中能显著提高强度，因火山灰活性',
            confidence: 0.9, source: 'doc1.pdf' }
        ]
      },
      {
        entities: [],
        relations: [
          { subjectId: 'a', predicate: 'increases', objectId: 'b',
            evidence: '来源B：硅灰在 UHPC 中能显著提高强度，因填充效应',
            confidence: 0.95, source: 'doc2.pdf' }
        ]
      },
      {
        entities: [],
        relations: [
          { subjectId: 'a', predicate: 'increases', objectId: 'b',
            evidence: '来源C：硅灰在高强混凝土中能显著提高强度，因高活性',
            confidence: 0.85, source: 'doc3.pdf' }
        ]
      }
    ]

    for (let i = 0; i < triples.length; i++) {
      const m = mergeInto(graph, triples[i], `doc${i + 1}.pdf`)
      graph = m.graph
      allConflicts = allConflicts.concat(m.conflicts)
    }

    // 无冲突（同 predicate）
    expect(allConflicts).toEqual([])
    expect(graph.conflicts).toEqual([])
    // 只有一个三元组（3 篇 evidence 合并）
    expect(graph.relations.length).toBe(1)
    // 原始 evidence（doc1）保留 + doc2/doc3 的 source 前缀追加
    expect(graph.relations[0].evidence).toContain('来源A')
    expect(graph.relations[0].evidence).toContain('来源B')
    expect(graph.relations[0].evidence).toContain('来源C')
    // mergeInto 用 `${source}: ${evidence}` 格式追加，doc2 和 doc3 应有前缀
    expect(graph.relations[0].evidence).toContain('doc2.pdf:')
    expect(graph.relations[0].evidence).toContain('doc3.pdf:')
  })
})

// ==================== E2E O: KG 查询验证 ====================

describe('P5 E2E O: searchGraph 命中三元组 < 100ms', () => {
  let wsPath

  beforeEach(async () => {
    wsPath = await mkTmpDir('p5-e2e-o')
    // 准备 fixture graph.json（硅灰 → 28d 抗压强度 + 钢纤维 → 抗拉强度）
    const fixture = {
      version: 1,
      workspacePath: wsPath.replace(/\\/g, '/'),
      entities: {
        guifei: { id: 'guifei', name: '硅灰', type: 'Material', aliases: ['硅粉'] },
        qiangdu: { id: 'qiangdu', name: '28d 抗压强度', type: 'Property', aliases: [] },
        gangxianwei: { id: 'gangxianwei', name: '钢纤维', type: 'Material', aliases: [] },
        antlaqiangdu: { id: 'antlaqiangdu', name: '抗拉强度', type: 'Property', aliases: [] }
      },
      relations: [
        {
          subjectId: 'guifei',
          predicate: 'increases',
          objectId: 'qiangdu',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因其高活性 SiO2 与 CH 反应',
          confidence: 0.95,
          source: 'UHPC.pdf'
        },
        {
          subjectId: 'gangxianwei',
          predicate: 'increases',
          objectId: 'antlaqiangdu',
          evidence: '钢纤维的桥接效应显著提高 UHPC 的抗拉强度至 7MPa 以上',
          confidence: 0.9,
          source: 'UHPC.pdf'
        }
      ],
      conflicts: [],
      mergeVersion: 1,
      createdAt: '2026-06-17T00:00:00Z',
      updatedAt: '2026-06-17T00:00:00Z',
      lastMergeAt: '2026-06-17T00:00:00Z'
    }
    await fs.mkdir(path.join(wsPath, 'wiki', 'kg'), { recursive: true })
    await fs.writeFile(
      path.join(wsPath, 'wiki', 'kg', 'graph.json'),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    )
  })

  afterEach(async () => {
    await rmTmpDir(wsPath)
  })

  test('searchGraph("硅灰 抗压强度") → < 100ms 返回 ≥1 个三元组（sub-predicate-obj）', async () => {
    const extractor = new KGExtractor({ llmClient: null })

    // 1) 性能测试：重复 10 次取平均（避免冷启动误差）
    const timings = []
    for (let i = 0; i < 10; i++) {
      const start = Date.now()
      const results = await extractor.searchGraph('硅灰 抗压强度', 5, wsPath)
      const elapsed = Date.now() - start
      timings.push(elapsed)
      // 每次都必须命中
      expect(results.length).toBeGreaterThanOrEqual(1)
    }
    // 平均耗时 < 100ms
    const avgMs = timings.reduce((a, b) => a + b, 0) / timings.length
    const maxMs = Math.max(...timings)
    // 平均应 < 100ms（max 给宽松一些，允许 GC 抖动）
    expect(avgMs).toBeLessThan(100)
    // max < 500ms（防止极端情况）
    expect(maxMs).toBeLessThan(500)

    // 2) 验证返回的三元组结构（sub-predicate-obj）
    const results = await extractor.searchGraph('硅灰 抗压强度', 5, wsPath)
    expect(results.length).toBeGreaterThanOrEqual(1)

    const top = results[0]
    // 完整三元组
    expect(top.subject).toBeDefined()
    expect(top.predicate).toBeDefined()
    expect(top.object).toBeDefined()
    // subject 含 name/type/id
    expect(top.subject.name).toBe('硅灰')
    expect(top.subject.type).toBe('Material')
    expect(typeof top.subject.id).toBe('string')
    // predicate
    expect(top.predicate).toBe('increases')
    // object
    expect(top.object.name).toBe('28d 抗压强度')
    expect(top.object.type).toBe('Property')
    // evidence + confidence + source + score
    expect(top.evidence).toContain('28d')
    expect(typeof top.confidence).toBe('number')
    expect(top.confidence).toBeGreaterThan(0)
    expect(top.source).toBe('UHPC.pdf')
    expect(typeof top.score).toBe('number')
  })

  test('searchGraph 别名命中："硅粉" → 命中硅灰相关三元组', async () => {
    const extractor = new KGExtractor({ llmClient: null })
    const results = await extractor.searchGraph('硅粉', 5, wsPath)
    expect(results.length).toBeGreaterThanOrEqual(1)
    // 至少一条 subject.name = '硅灰'（别名匹配）
    expect(results.some(r => r.subject.name === '硅灰')).toBe(true)
  })

  test('searchGraph 不调 LLM（纯 BM25 检索）', async () => {
    const llmSpy = jest.fn()
    const extractor = new KGExtractor({ llmClient: { invoke: llmSpy } })
    await extractor.searchGraph('硅灰', 5, wsPath)
    expect(llmSpy).not.toHaveBeenCalled()
  })
})