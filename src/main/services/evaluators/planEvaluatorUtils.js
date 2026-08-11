// src/main/services/evaluators/planEvaluatorUtils.js

/**
 * 平均单车装载量（按车辆数加权）
 * spec 6.0
 */
function calcAvgCapacity(capacityConfig) {
  const types = [
    { count: capacityConfig.selfOilTruckCount, capacity: capacityConfig.selfOilTruckCapacity },
    { count: capacityConfig.selfElecTruckCount, capacity: capacityConfig.selfElecTruckCapacity },
    { count: capacityConfig.rentalTruckCount, capacity: capacityConfig.rentalTruckCapacity }
  ]
  let totalVehicles = 0
  let totalCapacity = 0
  for (const t of types) {
    totalVehicles += t.count
    totalCapacity += t.count * t.capacity
  }
  return totalVehicles > 0 ? totalCapacity / totalVehicles : 8
}

/**
 * 计划车次数
 */
function calcPlanTrips(volume, avgCapacity) {
  return Math.ceil(volume / avgCapacity)
}

/**
 * 计划车次间隔（小时）
 */
function calcTripInterval(expectedDuration, planTrips) {
  return planTrips > 0 ? expectedDuration / planTrips : expectedDuration
}

/**
 * 车次 i 的发车时刻（分钟数，从0点算）
 * @param {string} plannedSendTime - "HH:mm"
 * @param {number} tripIndex - 0, 1, 2, ...
 * @param {number} intervalHours
 */
function calcTripSendMinute(plannedSendTime, tripIndex, intervalHours) {
  const [h, m] = plannedSendTime.split(':').map(Number)
  const startMinute = h * 60 + m
  return startMinute + tripIndex * intervalHours * 60
}

/**
 * 构建车辆池（按单价升序）
 */
function buildVehiclePool(capacityConfig) {
  const pool = []
  const types = [
    { type: 'selfOil', count: capacityConfig.selfOilTruckCount, capacity: capacityConfig.selfOilTruckCapacity, price: capacityConfig.selfOilTruckPrice },
    { type: 'selfElec', count: capacityConfig.selfElecTruckCount, capacity: capacityConfig.selfElecTruckCapacity, price: capacityConfig.selfElecTruckPrice },
    { type: 'rental', count: capacityConfig.rentalTruckCount, capacity: capacityConfig.rentalTruckCapacity, price: capacityConfig.rentalTruckPrice }
  ].sort((a, b) => a.price - b.price) // 按单价升序

  for (const t of types) {
    for (let i = 0; i < t.count; i++) {
      pool.push({ type: t.type, capacity: t.capacity, price: t.price, availableFrom: 0 })
    }
  }
  return pool
}

module.exports = {
  calcAvgCapacity,
  calcPlanTrips,
  calcTripInterval,
  calcTripSendMinute,
  buildVehiclePool
}
