const { buildBM25, queryBM25 } = require('../../workspace/bm25')

describe('BM25', () => {
  const docs = [
    { path: 'sources/a.md', content: '抗渗混凝土水胶比不应大于 0.45' },
    { path: 'sources/b.md', content: '普通混凝土配合比设计' },
    { path: 'sources/c.md', content: '抗冻融混凝土水胶比' }
  ]

  test('buildBM25 返回完整索引', () => {
    const idx = buildBM25(docs)
    expect(idx.totalDocs).toBe(3)
    // Task 2.4 TwoGramTokenizer 按 2-gram 切分，「水胶比」→ ['水胶', '胶比']
    // 「抗渗混凝土」→ ['抗渗', '渗混', '混凝', '凝土']
    expect(idx.vocabulary['抗渗']).toBeDefined()
    expect(idx.vocabulary['水胶']).toBeDefined()
    expect(idx.vocabulary['胶比']).toBeDefined()
  })

  test('query 抗渗 + 水胶比 → a.md 排第一', () => {
    const idx = buildBM25(docs)
    const results = queryBM25(idx, '抗渗 水胶比', 3)
    expect(results[0].path).toBe('sources/a.md')
  })

  test('query 普通 → b.md 命中', () => {
    const idx = buildBM25(docs)
    const results = queryBM25(idx, '普通混凝土')
    expect(results.find(r => r.path === 'sources/b.md')).toBeTruthy()
  })

  test('topK 限制返回数量', () => {
    const idx = buildBM25(docs)
    const results = queryBM25(idx, '混凝土', 1)
    expect(results).toHaveLength(1)
  })

  test('空 query 返回空数组', () => {
    const idx = buildBM25(docs)
    expect(queryBM25(idx, '', 5)).toEqual([])
  })
})