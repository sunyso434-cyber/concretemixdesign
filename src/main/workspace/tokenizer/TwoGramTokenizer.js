const STOPWORDS = new Set(['的', '了', '是', '在', '和', '与', '或', '等', 'a', 'an', 'the', 'of', 'to'])

function tokenize(text) {
  if (!text) return []
  // 1. 转小写
  const lower = text.toLowerCase()
  // 2. 提取英文/数字单词
  const wordTokens = lower.match(/[a-z0-9]+/g) || []
  // 3. 提取中文字符串
  const chineseText = lower.replace(/[a-z0-9\s]/g, ' ')
  // 4. 中文按 2-gram 切分
  const grams = []
  for (let i = 0; i < chineseText.length - 1; i++) {
    const gram = chineseText.substr(i, 2)
    if (/[一-龥]/.test(gram[0]) && /[一-龥]/.test(gram[1])) {
      grams.push(gram)
    }
  }
  // 5. 合并 + 去重 + 过滤
  const all = [...wordTokens, ...grams]
  return [...new Set(all)].filter(t => !STOPWORDS.has(t) && t.length > 0)
}

module.exports = { tokenize, TwoGramTokenizer: { tokenize } }
