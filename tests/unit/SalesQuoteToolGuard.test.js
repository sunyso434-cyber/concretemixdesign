const assert = require('assert')
const path = require('path')

const SalesQuoteToolGuard = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'services',
  'SalesQuoteToolGuard'
))

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

run('detects sales quote intent from user text', () => {
  assert.strictEqual(SalesQuoteToolGuard.isSalesQuoteIntent('帮我报一个C35抗渗单方价格'), true)
  assert.strictEqual(SalesQuoteToolGuard.isSalesQuoteIntent('给客户解释一下早强混凝土为什么贵'), true)
  assert.strictEqual(SalesQuoteToolGuard.isSalesQuoteIntent('设计一个C30配合比'), false)
})

run('blocks mix design tools in sales quote flow until user explicitly authorizes design', () => {
  const context = { isSalesQuoteIntent: true, userApprovedMixDesignForQuote: false }
  assert.strictEqual(SalesQuoteToolGuard.shouldBlockTool('calculate_mix_design', context), true)
  assert.strictEqual(SalesQuoteToolGuard.shouldBlockTool('optimize_mix_cost', context), true)
  assert.strictEqual(SalesQuoteToolGuard.shouldBlockTool('compare_materials', context), true)
  assert.strictEqual(SalesQuoteToolGuard.shouldBlockTool('calculate_sales_quote', context), false)
})

run('allows mix design tools after explicit quote design authorization', () => {
  const context = { isSalesQuoteIntent: true, userApprovedMixDesignForQuote: true }
  assert.strictEqual(SalesQuoteToolGuard.shouldBlockTool('calculate_mix_design', context), false)
})
