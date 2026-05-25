const assert = require('assert')
const {
  buildReviewContext,
  shouldSkipByDefaultAssumption,
  normalizeStringArray
} = require('../../src/main/services/StandardReviewContext')

// ============================================================
// Bug 2 Tests: "常规环境" 应匹配 "一类环境"
// ============================================================

const tests = []

tests.push({
  name: 'Bug2: 默认"常规环境"应匹配"一类环境"条款',
  run() {
    const ctx = buildReviewContext({ strength: 'C30' })
    assert.strictEqual(ctx.mixDesign.environment, '常规环境')

    const result = shouldSkipByDefaultAssumption(
      { applicability: { environment: ['一类环境'] } },
      ctx
    )
    assert.strictEqual(result.skip, false, `一类环境条款不应被跳过，但得到 skip=${result.skip}`)
  }
})

tests.push({
  name: 'Bug2: 用户指定环境时一类环境条款不跳过',
  run() {
    const ctx = buildReviewContext({ strength: 'C30', environment: '普通环境' })
    const result = shouldSkipByDefaultAssumption(
      { applicability: { environment: ['一类环境'] } },
      ctx
    )
    assert.strictEqual(result.skip, false)
  }
})

tests.push({
  name: 'Bug2: 特殊环境条款仍应被跳过',
  run() {
    const ctx = buildReviewContext({ strength: 'C30' })
    const result = shouldSkipByDefaultAssumption(
      { applicability: { environment: ['冻融环境'] } },
      ctx
    )
    assert.strictEqual(result.skip, true)
  }
})

tests.push({
  name: 'Bug2: 一类环境不被isSpecialEnvironment判定为特殊',
  run() {
    const ctx = buildReviewContext({ strength: 'C30', environment: '一类环境' })
    const result = shouldSkipByDefaultAssumption(
      { applicability: { environment: ['一类环境'] } },
      ctx
    )
    assert.strictEqual(result.skip, false)
  }
})

tests.push({
  name: 'Bug2: 用户指定二类环境时二a环境条款不跳过',
  run() {
    const ctx = buildReviewContext({ strength: 'C30', environment: '二a类环境' })
    const result = shouldSkipByDefaultAssumption(
      { applicability: { environment: ['二a类环境'] } },
      ctx
    )
    assert.strictEqual(result.skip, false)
  }
})

// ============================================================
// Bug 3 Tests: minTotalBinder 应映射到 binderContent 字段
// （将在 Task 3 中实现）
// ============================================================

// ============================================================
// Bug 1 Tests: 向量检索结果应传入AI Prompt
// （将在 Task 4 中实现）
// ============================================================

// ============================================================
// Run all tests
// ============================================================
let passed = 0
let failed = 0
let skipped = 0
for (const test of tests) {
  try {
    test.run()
    console.log(`✅ ${test.name}`)
    passed++
  } catch (err) {
    if (err.message && err.message.includes('暂未实现')) {
      console.log(`⏭️ ${test.name}`)
      skipped++
    } else {
      console.log(`❌ ${test.name}`)
      console.log(`   ${err.message}`)
      failed++
    }
  }
}
if (skipped > 0) {
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped, ${tests.length} total`)
} else {
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
}
process.exit(failed > 0 ? 1 : 0)
