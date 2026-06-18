const { tokenize } = require('./tokenizer')

const K1 = 1.5
const B = 0.75

function buildBM25(docs) {
  const vocabulary = {}  // term -> { df }
  const postings = {}    // term -> [path, ...]
  const docLengths = {}  // path -> token count

  for (const doc of docs) {
    const tokens = tokenize(doc.content)
    docLengths[doc.path] = tokens.length
    const seenInThisDoc = new Set()
    for (const t of tokens) {
      if (!seenInThisDoc.has(t)) {
        seenInThisDoc.add(t)
        vocabulary[t] = vocabulary[t] || { df: 0 }
        vocabulary[t].df++
        postings[t] = postings[t] || []
        postings[t].push(doc.path)
      }
    }
  }

  const totalDocs = docs.length
  const avgDocLength = totalDocs > 0
    ? Object.values(docLengths).reduce((a, b) => a + b, 0) / totalDocs
    : 0

  return { vocabulary, postings, docLengths, avgDocLength, totalDocs }
}

function queryBM25(index, query, topK = 5) {
  const queryTokens = tokenize(query)
  const scores = {}

  for (const t of queryTokens) {
    if (!index.postings[t]) continue
    const df = index.vocabulary[t].df
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5))

    for (const path of index.postings[t]) {
      const docLen = index.docLengths[path] || 0
      const tf = (index.postings[t].filter(p => p === path).length)
      const numerator = tf * (K1 + 1)
      const denominator = tf + K1 * (1 - B + B * (docLen / (index.avgDocLength || 1)))
      scores[path] = (scores[path] || 0) + idf * (numerator / denominator)
    }
  }

  // 归一化到 0-1
  const maxScore = Math.max(...Object.values(scores), 0.001)
  return Object.entries(scores)
    .map(([path, score]) => ({ path, score: score / maxScore }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => ({ ...r, snippet: '' }))  // snippet 在 WikiEngine.search 里生成
}

module.exports = { buildBM25, queryBM25, incrementBM25 }

function incrementBM25(index, newDocs) {
  // 简单实现：合并后重建（P1）
  const allDocs = Object.entries(index.docLengths).map(([path, len]) => ({ path, content: '' }))
    .concat(newDocs)
  return buildBM25(allDocs)
}