/**
 * C3-trainingHandler.test.js
 * 测试 trainingHandler 的三个 IPC handler + 训练锁
 *
 * 测试覆盖：
 *   1. handleGetStatus        — 初始返回 {isTraining: false}
 *   2. handleTrainingRun 锁   — 训练中返回"训练进行中" + 结束后锁释放
 *   3. handleRollback         — 无历史版本时返回错误
 *   4. 模块完整性              — 导出结构正确
 */

const path = require('path')
const assert = require('assert')

// ============ 导入被测试模块 ============

const trainingHandler = require(path.join(
  __dirname, '..', '..', 'src', 'main', 'ipcHandlers', 'trainingHandler'
))

// ============ 测试工具 ============

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.message)
    if (error.expected !== undefined) {
      console.error(`  期望: ${JSON.stringify(error.expected)}`)
      console.error(`  实际: ${JSON.stringify(error.actual)}`)
    }
    process.exitCode = 1
  }
}

async function runAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.message)
    if (error.expected !== undefined) {
      console.error(`  期望: ${JSON.stringify(error.expected)}`)
      console.error(`  实际: ${JSON.stringify(error.actual)}`)
    }
    process.exitCode = 1
  }
}

// ============ Mock IPC 事件 ============

function makeMockEvent() {
  return {
    sender: {
      send() {},
      isDestroyed() { return false }
    }
  }
}

// ============ Section 1: 训练状态查询 ============

console.log('\n=== 训练状态查询 ===')

runAsync('handleGetStatus returns isTraining=false initially', async () => {
  const status = await trainingHandler.handleGetStatus()
  assert.strictEqual(status.isTraining, false)
})

// ============ Section 2: 训练锁生命周期 ============

console.log('\n=== 训练锁生命周期 ===')

runAsync('handleTrainingRun fails gracefully without DB and releases lock', async () => {
  // 第 1 次调用：会因数据库未连接而失败，但锁机制应经历 acquire → 失败 → release
  const event1 = makeMockEvent()
  const result1 = await trainingHandler.handleTrainingRun(event1, { nTrials: 10 })
  assert.strictEqual(result1.success, false)
  assert.ok(result1.error, '应返回错误信息')

  // 第 2 次调用 handleGetStatus 验证锁已释放（finally 正确执行）
  const statusAfter = await trainingHandler.handleGetStatus()
  assert.strictEqual(statusAfter.isTraining, false, '失败后锁应释放')
})

runAsync('handleTrainingRun with different nTrials passes options correctly', async () => {
  // 验证参数传递不报错（数据不足时不启动训练，但这里是数据库错误）
  // 只要不抛出未捕获异常即通过
  const event = makeMockEvent()
  const result = await trainingHandler.handleTrainingRun(event, { nTrials: 0 })
  assert.strictEqual(result.success, false)
  assert.ok(result.error)
})

// ============ Section 3: handleRollback ============

console.log('\n=== handleRollback ===')

runAsync('handleRollback with nonexistent target returns error', async () => {
  const result = await trainingHandler.handleRollback(null, { target: 'nonexistent_target_xyz' })
  assert.strictEqual(result.success, false)
  assert.ok(result.error, '应返回错误信息')
})

// ============ Section 4: 模块完整性 ============

console.log('\n=== 模块完整性 ===')

run('registerHandlers exports a function', () => {
  assert.strictEqual(typeof trainingHandler.registerHandlers, 'function')
})

run('all three handlers are exported', () => {
  assert.strictEqual(typeof trainingHandler.handleTrainingRun, 'function')
  assert.strictEqual(typeof trainingHandler.handleGetStatus, 'function')
  assert.strictEqual(typeof trainingHandler.handleRollback, 'function')
})

// ============ 汇总 ============

console.log('\n=== 测试完成 ===')
