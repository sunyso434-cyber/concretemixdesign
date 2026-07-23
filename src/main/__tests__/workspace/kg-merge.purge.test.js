// Task 5 (P7): KG 按来源清旧 purgeBySource
// - 单来源关系被清+孤立实体清
// - 多来源共享只摘一个来源保留关系
// - 缺 sources 字段的存量关系不被误删
const { mergeInto, purgeBySource } = require('../../workspace/kg-merge')

function emptyGraph() {
  return { entities: {}, relations: [], conflicts: [], mergeVersion: 0 }
}
function triple(subjId, obj, pred) {
  return {
    entities: [
      { id: subjId, name: subjId, type: 'X' },
      { id: obj, name: obj, type: 'Y' }
    ],
    relations: [{ subjectId: subjId, objectId: obj, predicate: pred, evidence: 'e'.repeat(30), confidence: 0.9 }]
  }
}

describe('purgeBySource 按来源清旧', () => {
  test('单来源关系被清除，孤立实体一并清除', () => {
    let g = mergeInto(emptyGraph(), triple('A', 'B', 'increases'), 'f1.pdf').graph
    g = purgeBySource(g, 'f1.pdf')
    expect(g.relations.length).toBe(0)
    expect(Object.keys(g.entities).length).toBe(0)
  })

  test('多来源共享的关系只摘掉一个来源，关系保留', () => {
    let g = mergeInto(emptyGraph(), triple('A', 'B', 'increases'), 'f1.pdf').graph
    g = mergeInto(g, triple('A', 'B', 'increases'), 'f2.pdf').graph
    g = purgeBySource(g, 'f1.pdf')
    expect(g.relations.length).toBe(1)
    expect(g.relations[0].sources).toEqual(['f2.pdf'])
  })

  test('缺 sources 字段的存量关系不被误删', () => {
    const g0 = emptyGraph()
    g0.entities['A'] = { id: 'A', name: 'A', type: 'X' }
    g0.entities['B'] = { id: 'B', name: 'B', type: 'Y' }
    g0.relations.push({ subjectId: 'A', objectId: 'B', predicate: 'old', evidence: 'x' }) // 无 sources
    const g = purgeBySource(g0, 'f1.pdf')
    expect(g.relations.length).toBe(1)
    expect(Object.keys(g.entities).length).toBe(2)
  })
})