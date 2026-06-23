const { tokenizeQuery, scoreSegment, computeIdf } = require('../relevance')

describe('relevance', () => {
  describe('computeIdf', () => {
    test('单段 → 所有 IDF 相等且 > 0', () => {
      const idf = computeIdf([['ab', 'cd']])
      // N=1, df=1 → log((1-1+0.5)/(1+0.5)+1) = log(4/3) ≈ 0.2877
      expect(idf.get('ab')).toBeCloseTo(Math.log(4 / 3), 5)
      expect(idf.get('cd')).toBeCloseTo(Math.log(4 / 3), 5)
      expect(idf.get('ab')).toBe(idf.get('cd'))
    })

    test('多段 → 稀有词 IDF > 高频词 IDF', () => {
      const idf = computeIdf([
        ['ab', 'cd'],
        ['ab', 'ef'],
        ['gh', 'ij']
      ])
      // ab: df=2, ef: df=1 → ef 的 IDF 应更大
      expect(idf.get('ef')).toBeGreaterThan(idf.get('ab'))
    })
  })

  describe('scoreSegment', () => {
    test('命中 → 返回 > 0', () => {
      const segTokens = new Set(['ab', 'cd', 'ef'])
      const queryTokens = new Set(['ab', 'xy'])
      const score = scoreSegment(segTokens, queryTokens)
      expect(score).toBeGreaterThan(0)
    })

    test('未命中 → 返回 0', () => {
      const segTokens = new Set(['ab', 'cd'])
      const queryTokens = new Set(['xy', 'zz'])
      const score = scoreSegment(segTokens, queryTokens)
      expect(score).toBe(0)
    })

    test('空 query → 返回 0', () => {
      const segTokens = new Set(['ab', 'cd'])
      const score = scoreSegment(segTokens, new Set())
      expect(score).toBe(0)
    })
  })

  describe('tokenizeQuery', () => {
    test('中文 → 返回 2-gram Set', () => {
      const result = tokenizeQuery('混凝土强度')
      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBeGreaterThan(0)
      // 应包含至少一个 2-gram
      const arr = [...result]
      expect(arr.some(t => /[一-鿿]{2}/.test(t))).toBe(true)
    })
  })
})
