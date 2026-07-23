// Task 4 (P6): KG 实体/关系补 sources 来源归属字段
// - 新 relation/entity 带 sources: [source]
// - 已存在则去重合并 sources
// - 同 source 重复合并不产生重复来源
const { mergeInto } = require('../../workspace/kg-merge')

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

describe('mergeInto 维护 sources 归属', () => {
  test('新关系带来源文件名', () => {
    const { graph } = mergeInto(emptyGraph(), triple('A', 'B', 'increases'), 'f1.pdf')
    expect(graph.relations[0].sources).toEqual(['f1.pdf'])
    expect(graph.entities['A'].sources).toContain('f1.pdf')
  })

  test('同一关系被两个文件贡献 → sources 去重合并', () => {
    let g = mergeInto(emptyGraph(), triple('A', 'B', 'increases'), 'f1.pdf').graph
    g = mergeInto(g, triple('A', 'B', 'increases'), 'f2.pdf').graph
    expect(g.relations.length).toBe(1)
    expect(g.relations[0].sources.sort()).toEqual(['f1.pdf', 'f2.pdf'])
  })

  test('同文件重复合并不产生重复来源', () => {
    let g = mergeInto(emptyGraph(), triple('A', 'B', 'increases'), 'f1.pdf').graph
    g = mergeInto(g, triple('A', 'B', 'increases'), 'f1.pdf').graph
    expect(g.relations[0].sources).toEqual(['f1.pdf'])
  })
})
