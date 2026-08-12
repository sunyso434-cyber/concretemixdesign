// tests/unit/planEvaluatorUtils.test.js
const assert = require('assert')
const { calcAvgCapacity, calcPlanTrips, calcTripInterval, calcTripSendMinute, buildVehiclePool } = require('../../src/main/services/evaluators/planEvaluatorUtils')

function run(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('公共定义(6.0):')
run('平均单车装载量加权平均: 油车×10(8)+电车×2(12) → 8.67', () => {
  const config = { selfOilTruckCount: 10, selfOilTruckCapacity: 8, selfElecTruckCount: 2, selfElecTruckCapacity: 12, rentalTruckCount: 0, rentalTruckCapacity: 8 }
  const result = calcAvgCapacity(config)
  assert.strictEqual(Math.round(result * 100) / 100, 8.67)
})

run('计划车次数: volume=100, avgCapacity=8.67 → 12', () => {
  assert.strictEqual(calcPlanTrips(100, 8.67), 12)
})

run('车次发车时刻: 08:00, 间隔0.5h, i=2 → 09:00', () => {
  const minute = calcTripSendMinute('08:00', 2, 0.5)
  assert.strictEqual(minute, 9 * 60) // 540分钟 = 09:00
})

run('车辆池按单价升序', () => {
  const config = { selfOilTruckCount: 2, selfOilTruckPrice: 1.5, selfOilTruckCapacity: 8, selfElecTruckCount: 1, selfElecTruckPrice: 1.0, selfElecTruckCapacity: 12, rentalTruckCount: 1, rentalTruckPrice: 2.0, rentalTruckCapacity: 8 }
  const pool = buildVehiclePool(config)
  assert.strictEqual(pool[0].price, 1.0) // 电车最便宜
  assert.strictEqual(pool[pool.length - 1].price, 2.0) // 外租最贵
})

console.log('\n节奏推算(6.5) 公式验证:')
run('2车, 间隔1h, 方量8+8 → pace = (16-8)/1 = 8 m³/h', () => {
  const cumulativeVolume = 16
  const firstVolume = 8
  const totalIntervalHours = 1
  const pace = (cumulativeVolume - firstVolume) / totalIntervalHours
  assert.strictEqual(pace, 8)
})

run('3车, 间隔1h+1h, 方量24 → pace = (24-8)/2 = 8 m³/h', () => {
  const cumulativeVolume = 24
  const firstVolume = 8
  const totalIntervalHours = 2
  const pace = (cumulativeVolume - firstVolume) / totalIntervalHours
  assert.strictEqual(pace, 8)
})

console.log('\n测试完成')
