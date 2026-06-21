// Task 5.3 (P5): kg-merge.js + 冲突检测 + compact + 大小守卫
// - 覆盖 v1.5 原始设计（plan line 4116-4377）
// - mergeInto: 合并新实体 / 冲突关系 / 类型冲突
// - compactGraph: 低置信度 / 三元组去重 / 孤立实体
// - checkSize: 50MB 抛错 / 5万 relations 抛错 / 1万 relations warning
const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')
const { mergeInto, compactGraph, checkSize } = require('../../workspace/kg-merge')
const { WorkspaceError } = require('../../workspace/WorkspaceError')

// ============ mergeInto（plan Step 1-2）============

describe('mergeInto', () => {
  test('合并新实体到图谱', () => {
    const oldGraph = { entities: {}, relations: [], conflicts: [], mergeVersion: 0 }
    const newTriples = {
      entities: [{ id: 'aaa', name: '硅灰', type: 'Material', aliases: [], source: 't.pdf' }],
      relations: []
    }
    const { graph, conflicts } = mergeInto(oldGraph, newTriples, 't.pdf')
    expect(graph.entities.aaa.name).toBe('硅灰')
    expect(graph.mergeVersion).toBe(1)
    expect(conflicts).toEqual([])
  })

  test('冲突关系检测 - 相同 (s,o) 不同 predicate', () => {
    const oldGraph = {
      entities: {
        a: { id: 'a', name: '硅灰', type: 'Material' },
        b: { id: 'b', name: '强度', type: 'Property' }
      },
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因火山灰活性',
          confidence: 0.9, source: 'old.pdf' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    const newTriples = {
      entities: [],
      relations: [{ subjectId: 'a', predicate: 'decreases', objectId: 'b',
        evidence: '过量硅灰会降低后期强度发展，因为孔隙率上升和自收缩加剧',
        confidence: 0.8, source: 'new.pdf' }]
    }
    const { graph, conflicts } = mergeInto(oldGraph, newTriples, 'new.pdf')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('conflicting_relation')
    // 两条关系都保留
    expect(graph.relations).toHaveLength(2)
    // 冲突也写入 graph.conflicts
    expect(graph.conflicts.find(c => c.type === 'conflicting_relation')).toBeTruthy()
  })

  test('类型冲突（同名不同 type）', () => {
    const oldGraph = {
      entities: { a: { id: 'a', name: '硅灰', type: 'Material', aliases: [] } },
      relations: [], conflicts: [], mergeVersion: 1
    }
    const newTriples = {
      entities: [{ id: 'a', name: '硅灰', type: 'Admixture', aliases: [] }],
      relations: []
    }
    const { graph, conflicts } = mergeInto(oldGraph, newTriples, 'new.pdf')
    expect(conflicts.find(c => c.type === 'type_mismatch')).toBeTruthy()
  })

  test('同 predicate 重复 - 合并 evidence + 取最高 confidence', () => {
    const oldGraph = {
      entities: {
        a: { id: 'a', name: '硅灰', type: 'Material' },
        b: { id: 'b', name: '强度', type: 'Property' }
      },
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度，因火山灰活性',
          confidence: 0.7, source: 'old.pdf' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    const newTriples = {
      entities: [],
      relations: [{ subjectId: 'a', predicate: 'increases', objectId: 'b',
        evidence: '硅灰在 UHPC 中能显著提高抗压强度，因填充效应',
        confidence: 0.95, source: 'new.pdf' }]
    }
    const { graph, conflicts } = mergeInto(oldGraph, newTriples, 'new.pdf')
    expect(conflicts).toEqual([])
    expect(graph.relations).toHaveLength(1)
    expect(graph.relations[0].confidence).toBe(0.95)
    // 原 evidence 保留 + 新 evidence 以 "new.pdf: ..." 追加
    expect(graph.relations[0].evidence).toContain('硅灰能显著提高')
    expect(graph.relations[0].evidence).toContain('硅灰在 UHPC')
    expect(graph.relations[0].evidence).toContain('new.pdf:')
  })

  test('aliases 合并（同名 entity）', () => {
    const oldGraph = {
      entities: { a: { id: 'a', name: '硅灰', type: 'Material', aliases: ['硅粉'] } },
      relations: [], conflicts: [], mergeVersion: 1
    }
    const newTriples = {
      entities: [{ id: 'a', name: '硅灰', type: 'Material', aliases: ['microsilica'] }],
      relations: []
    }
    const { graph } = mergeInto(oldGraph, newTriples, 'new.pdf')
    expect(graph.entities.a.aliases).toEqual(expect.arrayContaining(['硅粉', 'microsilica']))
  })
})

// ============ compactGraph（plan Step 4）============

describe('compactGraph', () => {
  test('去除 confidence < 0.3 的 relation', () => {
    const g = {
      version: 1,
      entities: {
        a: { id: 'a', name: 'A', type: 'Material' },
        b: { id: 'b', name: 'B', type: 'Property' }
      },
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '高质量证据：硅灰能显著提高混凝土的 28d 抗压强度',
          confidence: 0.9, source: 'x.pdf' },
        { subjectId: 'a', predicate: 'decreases', objectId: 'b',
          evidence: '低置信度证据：硅灰在某种条件下会降低后期强度发展',
          confidence: 0.2, source: 'y.pdf' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    const out = compactGraph(g)
    expect(out.relations).toHaveLength(1)
    expect(out.relations[0].confidence).toBe(0.9)
  })

  test('去除孤立 entity（无 relation 引用）', () => {
    const g = {
      version: 1,
      entities: {
        a: { id: 'a', name: 'A', type: 'Material' },
        b: { id: 'b', name: 'B', type: 'Property' },
        c: { id: 'c', name: 'C', type: 'Spec' }   // 孤立
      },
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度', confidence: 0.9, source: 'x' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    const out = compactGraph(g)
    expect(Object.keys(out.entities).sort()).toEqual(['a', 'b'])
    expect(out.entities.c).toBeUndefined()
  })

  test('去重相同三元组（subject+predicate+object）', () => {
    const g = {
      version: 1,
      entities: {
        a: { id: 'a', name: 'A', type: 'Material' },
        b: { id: 'b', name: 'B', type: 'Property' }
      },
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '第一条证据：硅灰能显著提高混凝土的 28d 抗压强度',
          confidence: 0.7, source: 'x.pdf' },
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '第二条证据：硅灰在 UHPC 中能显著提高抗压强度',
          confidence: 0.9, source: 'y.pdf' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    const out = compactGraph(g)
    expect(out.relations).toHaveLength(1)
    // 保留最高 confidence
    expect(out.relations[0].confidence).toBe(0.9)
    // 两条 evidence 都保留（第二条以 "y.pdf: ..." 追加）
    expect(out.relations[0].evidence).toContain('第一条证据')
    expect(out.relations[0].evidence).toContain('第二条证据')
    expect(out.relations[0].evidence).toContain('y.pdf:')
  })

  test('不修改入参图（不可变性）', () => {
    const g = {
      version: 1,
      entities: {
        a: { id: 'a', name: 'A', type: 'Material' },
        b: { id: 'b', name: 'B', type: 'Property' },
        c: { id: 'c', name: 'C', type: 'Spec' }
      },
      relations: [
        { subjectId: 'a', predicate: 'increases', objectId: 'b',
          evidence: '硅灰能显著提高混凝土的 28d 抗压强度', confidence: 0.9, source: 'x' }
      ],
      conflicts: [],
      mergeVersion: 1
    }
    compactGraph(g)
    // 原图未变
    expect(Object.keys(g.entities)).toHaveLength(3)
    expect(g.relations).toHaveLength(1)
  })
})

// ============ checkSize（plan Step 4 - 大小守卫）============

describe('checkSize', () => {
  test('正常大小不抛错 + 无 warning', () => {
    const g = {
      entities: { a: { id: 'a', name: 'A', type: 'Material' } },
      relations: [{ subjectId: 'a', predicate: 'x', objectId: 'a',
        evidence: 'e', confidence: 0.5, source: 's' }]
    }
    const result = checkSize(g)
    expect(result.warnings).toEqual([])
  })

  test('1万 relations 触发 warning（不抛）', () => {
    const g = { entities: {}, relations: [] }
    for (let i = 0; i < 10001; i++) {
      g.relations.push({
        subjectId: 'a', predicate: 'x', objectId: 'b',
        evidence: 'e', confidence: 0.5, source: 's'
      })
    }
    const result = checkSize(g)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/1 万|10000/)
  })

  test('5万 relations 抛 INDEX_TOO_LARGE', () => {
    const g = { entities: {}, relations: [] }
    for (let i = 0; i < 50001; i++) {
      g.relations.push({
        subjectId: 'a', predicate: 'x', objectId: 'b',
        evidence: 'e', confidence: 0.5, source: 's'
      })
    }
    expect(() => checkSize(g)).toThrow(WorkspaceError)
    try {
      checkSize(g)
    } catch (err) {
      expect(err.code).toBe('INDEX_TOO_LARGE')
    }
  })

  test('graph.json > 50MB 抛 INDEX_TOO_LARGE（用大 evidence 撑大 JSON）', () => {
    // 构造一个 relation evidence 长度 > 50MB（不实际分配）
    const bigEvidence = 'A'.repeat(51 * 1024 * 1024)
    const g = {
      entities: {},
      relations: [{
        subjectId: 'a', predicate: 'x', objectId: 'b',
        evidence: bigEvidence, confidence: 0.5, source: 's'
      }]
    }
    let err
    try { checkSize(g) } catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.code).toBe('INDEX_TOO_LARGE')
  })
})
