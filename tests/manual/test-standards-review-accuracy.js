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

tests.push({
  name: 'Bug2: ComplianceRuleEngine evaluateClauses支持常规环境匹配一类环境条款',
  run() {
    const ComplianceRuleEngine = require('../../src/main/services/ComplianceRuleEngine')

    // 模拟配合比，环境为默认"常规环境"
    const mixDesign = { strength: 'C30', waterBinderRatio: 0.45 }

    // 结构：一类环境水胶比限值条款
    const clauses = [
      {
        standardName: 'JGJ 55-2011',
        section: '7.2.1',
        title: '一类环境C30混凝土最大水胶比不应大于0.55',
        originalText: '一类环境C30混凝土最大水胶比不应大于0.55',
        applicability: { environment: ['一类环境'] },
        limitRules: [
          { targetField: 'waterBinderRatio', operator: '<=', value: 0.55 }
        ],
        role: 'REVIEW_RULE'
      },
      {
        standardName: 'JGJ 55-2011',
        section: '7.2.2',
        title: '冻融环境C30混凝土最大水胶比不应大于0.50',
        originalText: '冻融环境C30混凝土最大水胶比不应大于0.50',
        applicability: { environment: ['冻融环境'] },
        limitRules: [
          { targetField: 'waterBinderRatio', operator: '<=', value: 0.50 }
        ],
        role: 'REVIEW_RULE'
      }
    ]

    const result = ComplianceRuleEngine.evaluateClauses(mixDesign, clauses)
    // 一类环境条款应被匹配（因为默认常规环境=一类环境）
    const matchedRule = result.ruleResults.find(r => r.clause === '7.2.1')
    assert.ok(matchedRule, '一类环境水胶比限值条款应被匹配')
    // 冻融环境条款应被跳过
    const skippedFrozen = result.skippedSpecialRules.find(s => s.clause === '7.2.2')
    assert.ok(skippedFrozen, '冻融环境条款应被跳过')
    // 假设列表应有环境默认假设
    assert.ok(result.assumptions.length > 0, '应有默认环境假设')
  }
})

// ============================================================
// Bug 3 Tests: minTotalBinder 应映射到 binderContent 字段
// ============================================================

tests.push({
  name: 'Bug3: normalizeMixDesign正确计算binderContent',
  run() {
    const { normalizeMixDesign } = require('../../src/main/services/ComplianceRuleEngine')
    const m = normalizeMixDesign({
      strength: 'C30',
      cementContent: 280,
      flyAshAmount: 100,
      waterBinderRatio: 0.45
    })
    assert.strictEqual(m.cementContent, 280)
    assert.strictEqual(m.binderContent, 380)
    assert.strictEqual(m.waterBinderRatio, 0.45)
  }
})

tests.push({
  name: 'Bug3: _buildQueryText包含胶凝材料总量等缺失参数',
  run() {
    const Module = require('module')
    const originalRequire = Module.prototype.require
    Module.prototype.require = function(p) {
      if (p === 'electron') return { app: { getPath: () => process.cwd() } }
      return originalRequire.apply(this, arguments)
    }
    const StandardComplianceService = require('../../src/main/services/StandardComplianceService')
    Module.prototype.require = originalRequire

    const service = new StandardComplianceService({ apiKey: 'test-key' })
    const query = service._buildQueryText({
      strength: 'C30',
      binderContent: 380,
      chlorideContent: 0.06,
      mudContent: 3.0,
      micaContent: 1.5,
      waterAmount: 175
    })

    assert.ok(query.includes('胶凝材料总量'), '应包含胶凝材料总量')
    assert.ok(query.includes('氯离子含量'), '应包含氯离子含量')
    assert.ok(query.includes('含泥量'), '应包含含泥量')
    assert.ok(query.includes('云母含量'), '应包含云母含量')
    assert.ok(query.includes('用水量'), '应包含用水量')
  }
})

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
