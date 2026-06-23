const { tokenize } = require('./tokenizer/TwoGramTokenizer')

function tokenizeQuery(query) {
  return new Set(tokenize(query || ''))
}

function scoreSegment(segmentTokens, queryTokens, idfMap) {
  if (!queryTokens || queryTokens.size === 0) return 0
  let score = 0
  let hits = 0
  for (const tok of queryTokens) {
    if (segmentTokens.has(tok)) {
      hits++
      const idf = idfMap && idfMap.has(tok) ? idfMap.get(tok) : 1
      score += idf
    }
  }
  if (hits === 0) return 0
  return score / Math.sqrt(segmentTokens.size + 1)
}

function computeIdf(segmentTokensList) {
  const N = segmentTokensList.length
  if (N === 0) return new Map()
  const df = new Map()
  for (const tokens of segmentTokensList) {
    const unique = new Set(tokens)
    for (const tok of unique) {
      df.set(tok, (df.get(tok) || 0) + 1)
    }
  }
  const idfMap = new Map()
  for (const [tok, dfVal] of df) {
    idfMap.set(tok, Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1))
  }
  return idfMap
}

module.exports = { tokenizeQuery, scoreSegment, computeIdf }
