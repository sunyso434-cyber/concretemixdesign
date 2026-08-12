// src/main/services/__tests__/DailyPlanService.test.js
const assert = require('assert')
// ★ 从 Service import，不是自己定义副本
const DailyPlanService = require('../DailyPlanService')
const { deriveStatus, deriveOverBudget } = DailyPlanService

function run(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('status派生值(2.8) - 从Service import:')
run('executedVolume=0 → planned', () => {
  assert.strictEqual(deriveStatus(0, 100), 'planned')
})

run('0<executedVolume<volume → executing', () => {
  assert.strictEqual(deriveStatus(50, 100), 'executing')
})

run('executedVolume>=volume → completed', () => {
  assert.strictEqual(deriveStatus(100, 100), 'completed')
})

run('executedVolume>volume → completed + overBudget', () => {
  assert.strictEqual(deriveStatus(120, 100), 'completed')
  assert.strictEqual(deriveOverBudget(120, 100), true)
})

run('删车次后executedVolume<volume → 自动回退到executing', () => {
  // 派生值天然支持回退
  assert.strictEqual(deriveStatus(80, 100), 'executing')
})

console.log('\n测试完成')
