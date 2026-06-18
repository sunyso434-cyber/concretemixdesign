// V1: TwoGram. V1.5 预留 jieba 注入。
const { tokenize } = require('./TwoGramTokenizer')
module.exports = { tokenize, TwoGramTokenizer: require('./TwoGramTokenizer') }
