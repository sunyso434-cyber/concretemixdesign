const { tokenize, TwoGramTokenizer } = require('../../workspace/tokenizer')

describe('TwoGramTokenizer', () => {
  test('英文按单词切分', () => {
    const tokens = tokenize('Water cement ratio is 0.42')
    expect(tokens).toContain('water')
    expect(tokens).toContain('cement')
    expect(tokens).toContain('ratio')
  })

  test('中文按 2-gram 切分', () => {
    const tokens = tokenize('抗渗混凝土')
    expect(tokens).toContain('抗渗')
    expect(tokens).toContain('渗混')
    expect(tokens).toContain('混凝')
    expect(tokens).toContain('凝土')
  })

  test('过滤停用词', () => {
    const tokens = tokenize('混凝土的水胶比')
    expect(tokens).not.toContain('的')
  })

  test('去重 + 小写', () => {
    const tokens = tokenize('Water water WATER')
    expect(tokens.filter(t => t === 'water').length).toBe(1)
  })
})
