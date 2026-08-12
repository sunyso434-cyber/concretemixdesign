// Mock 整个 db（pure 私有方法不触发 db）
jest.mock('../../db/database', () => ({}))

const RemainingSupplyOptimizer = require('../../services/evaluators/RemainingSupplyOptimizer')
const I = RemainingSupplyOptimizer  // singleton 实例，保留 this 上下文
// 解构出来的方法内部用 this._timeDiffMin，需通过 .call(I, ...) 调用
const _calcPace = (...args) => I._calcPace(...args)
const _calcSendTimeFix = (...args) => I._calcSendTimeFix(...args)
const _calcRemainingRisk = (...args) => I._calcRemainingRisk(...args)

describe('RemainingSupplyOptimizer', () => {
  // ===== T1: 节奏公式回归 v3 bug =====
  // pace = (累计方量 - 首车方量) / 总间隔时间
  // 2 车 [8m³ @08:00, 8m³ @09:00] → cumulativeVolume=16, firstVolume=8, totalInterval=1h
  // pace = (16-8)/1 = 8 m³/h
  describe('_calcPace', () => {
    test('T1a 2 车 8m³+8m³ 间隔 1h → paceM3h = 8', () => {
      const vData = [
        { productionDate: '2026-08-11', productionTime: '08:00', volume: 8 },
        { productionDate: '2026-08-11', productionTime: '09:00', volume: 8 }
      ]
      const pace = _calcPace(vData)
      expect(pace.paceM3h).toBe(8)
      expect(pace.paceStatus).toBe('paceKnown')
    })

    test('T1b 单车 → paceUnknown', () => {
      const vData = [{ productionDate: '2026-08-11', productionTime: '08:00', volume: 8 }]
      expect(_calcPace(vData)).toEqual({ paceM3h: null, paceStatus: 'paceUnknown' })
    })

    test('T1c 空数组 → paceUnknown', () => {
      expect(_calcPace([])).toEqual({ paceM3h: null, paceStatus: 'paceUnknown' })
    })
  })

  // ===== T2: 发料间隔偏差 =====
  describe('_calcSendTimeFix', () => {
    test('T2 实际间隔(2h) 远超计划间隔(0.67h) → actualInterval > plannedInterval*1.2', () => {
      // plan: 20m³, expectedDuration=2h
      // config: selfOilTruckCount=1, capacity=8 → avgCapacity=8
      // planTrips = ceil(20/8) = 3
      // plannedInterval = 2/3 ≈ 0.67h
      const plan = {
        id: 1, volume: 20,
        expectedDuration: 2,
        plannedSendTime: '08:00'
      }
      const vData = [
        { productionDate: '2026-08-11', productionTime: '10:00', volume: 8 },
        { productionDate: '2026-08-11', productionTime: '12:00', volume: 8 }
      ]
      const config = {
        selfOilTruckCount: 1, selfOilTruckCapacity: 8,
        selfElecTruckCount: 0, selfElecTruckCapacity: 0,
        rentalTruckCount: 0, rentalTruckCapacity: 0
      }
      const fix = _calcSendTimeFix(plan, vData, config)
      // actualInterval = (12-10) = 2h
      // plannedInterval = 2/3 ≈ 0.67h
      expect(fix.plannedInterval).toBeCloseTo(2 / 3, 2)
      expect(fix.actualInterval).toBeCloseTo(2, 1)
      expect(fix.actualInterval).toBeGreaterThan(fix.plannedInterval * 1.2)
    })
  })

  // ===== T3: 剩余风险判断 =====
  describe('_calcRemainingRisk', () => {
    test('T3 pace 太慢 (5m³/h), 剩余 50m³, 期望 2h → canFinishOnTime=false', () => {
      // remaining=50, pace=5 → remainingHoursNeeded=10h
      // elapsedHours=Date.now()-planDate, 远超 expectedDuration=2
      // remainingTimeAvailable=2-elapsedHours=负值 → canFinish=false
      const plan = {
        planDate: '2020-01-01',  // 远古日期 → elapsedHours 巨大
        plannedSendTime: '08:00',
        expectedDuration: 2
      }
      const pace = { paceM3h: 5, paceStatus: 'paceKnown' }
      const risk = _calcRemainingRisk(plan, 50, 50, pace, { c30Efficiency: 10 })
      expect(risk.canFinishOnTime).toBe(false)
      expect(risk.remainingHoursNeeded).toBe(10)
      expect(risk.risk).toBe('delay')
    })

    test('T3b remaining=0 → canFinishOnTime=true, risk=none', () => {
      const plan = {
        planDate: '2020-01-01', plannedSendTime: '08:00', expectedDuration: 2
      }
      const risk = _calcRemainingRisk(plan, 100, 0, { paceM3h: 5, paceStatus: 'paceKnown' }, {})
      expect(risk.canFinishOnTime).toBe(true)
      expect(risk.risk).toBe('none')
    })

    test('T3c paceUnknown → risk=unknown, canFinishOnTime=true', () => {
      const plan = {
        planDate: '2020-01-01', plannedSendTime: '08:00', expectedDuration: 2
      }
      const risk = _calcRemainingRisk(plan, 50, 50, { paceM3h: null, paceStatus: 'paceUnknown' }, {})
      expect(risk.canFinishOnTime).toBe(true)
      expect(risk.risk).toBe('unknown')
    })
  })
})
