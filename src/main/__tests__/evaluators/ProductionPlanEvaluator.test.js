// Mock 整个 db（pure 私有方法不触发 db，留空对象即可）
jest.mock('../../db/database', () => ({}))

const ProductionPlanEvaluator = require('../../services/evaluators/ProductionPlanEvaluator')
const I = ProductionPlanEvaluator  // singleton 实例，保留 this 上下文
// 解构出来的方法仍需通过 .call(I, ...) 调用，因内部用 this._xxx
const _calcCapacityWarning = (...args) => I._calcCapacityWarning(...args)
const _calcComprehensiveSuggestions = (...args) => I._calcComprehensiveSuggestions(...args)
const _isPeak = (...args) => I._isPeak(...args)
const _isCapacityAvailable = (...args) => I._isCapacityAvailable(...args)
const _isTransportAvailable = (...args) => I._isTransportAvailable(...args)

describe('ProductionPlanEvaluator', () => {
  // ===== T1: 单计划不超载（绿）=====
  describe('_calcCapacityWarning', () => {
    test('T1 单计划 50m³ 在 2h 内 + 2 线 C30 → 绿', () => {
      // config: lineCount=2, c30Efficiency=30 → maxCapacity=60
      // plan: 50m³ / 2h = 25 m³/h hourlyLoad, peak 25 < 60, overloadPercent < 0
      const config = {
        id: 1, branchName: 'B1',
        lineCount: 2, c30Efficiency: 30,
        mixCoefficients: { C30: 1.0 }
      }
      const plans = [{
        id: 1, branchId: 1,
        strengthGrade: 'C30', volume: 50,
        plannedSendTime: '08:00', expectedDuration: 2
      }]
      const w = _calcCapacityWarning(plans, config)
      expect(w.branchId).toBe(1)
      expect(w.riskLevel).toBe('绿')
      expect(w.overloadPercent).toBeLessThanOrEqual(5)
      expect(w.maxCapacity).toBe(60)
    })

    // ===== T2: 多计划红黄绿 =====
    test('T2a 严重超载 → 红（overloadPercent > 20）', () => {
      // maxCapacity = 2 * 30 = 60
      // plan: 100m³ / 1h = 100 m³/h, overloadPercent = (100-60)/60*100 = 66.7
      const config = {
        id: 1, branchName: 'B1',
        lineCount: 2, c30Efficiency: 30,
        mixCoefficients: { C30: 1.0 }
      }
      const plans = [{
        id: 1, branchId: 1,
        strengthGrade: 'C30', volume: 100,
        plannedSendTime: '08:00', expectedDuration: 1
      }]
      const w = _calcCapacityWarning(plans, config)
      expect(w.riskLevel).toBe('红')
      expect(w.overloadPercent).toBeGreaterThan(20)
    })

    test('T2b 中度超载 → 黄（5 < overloadPercent ≤ 20）', () => {
      // maxCapacity = 2 * 30 = 60
      // plan: 65m³ / 1h = 65 m³/h, overloadPercent = (65-60)/60*100 = 8.33
      const config = {
        id: 1, branchName: 'B1',
        lineCount: 2, c30Efficiency: 30,
        mixCoefficients: { C30: 1.0 }
      }
      const plans = [{
        id: 1, branchId: 1,
        strengthGrade: 'C30', volume: 65,
        plannedSendTime: '08:00', expectedDuration: 1
      }]
      const w = _calcCapacityWarning(plans, config)
      expect(w.riskLevel).toBe('黄')
      expect(w.overloadPercent).toBeGreaterThan(5)
      expect(w.overloadPercent).toBeLessThanOrEqual(20)
    })

    test('T2c 健康 → 绿（overloadPercent ≤ 5）', () => {
      // maxCapacity = 2 * 30 = 60
      // plan: 60m³ / 1h = 60 m³/h, overloadPercent = 0
      const config = {
        id: 1, branchName: 'B1',
        lineCount: 2, c30Efficiency: 30,
        mixCoefficients: { C30: 1.0 }
      }
      const plans = [{
        id: 1, branchId: 1,
        strengthGrade: 'C30', volume: 60,
        plannedSendTime: '08:00', expectedDuration: 1
      }]
      const w = _calcCapacityWarning(plans, config)
      expect(w.riskLevel).toBe('绿')
      expect(w.overloadPercent).toBeLessThanOrEqual(5)
    })
  })

  // ===== T3: 高峰系数应用 =====
  describe('_isPeak', () => {
    const dist = {
      peakStart1: '08:00', peakEnd1: '09:00',
      peakStart2: '17:00', peakEnd2: '18:00',
      peakFactor: 1.5
    }
    test('T3a 08:30 在 08-09 高峰内 → true', () => {
      expect(_isPeak(8 * 60 + 30, dist)).toBe(true)
    })
    test('T3b 10:00 不在高峰内 → false', () => {
      expect(_isPeak(10 * 60, dist)).toBe(false)
    })
    test('T3c 无 peakStart1 配置 → false', () => {
      expect(_isPeak(8 * 60 + 30, { peakFactor: 1.5 })).toBe(false)
    })
  })

  // ===== T4: _isCapacityAvailable / _isTransportAvailable =====
  describe('_isCapacityAvailable / _isTransportAvailable', () => {
    test('T5a capWarnings 含 branchId=1(绿) → true', () => {
      const capWarnings = [{ branchId: 1, riskLevel: '绿' }]
      expect(_isCapacityAvailable(1, capWarnings)).toBe(true)
    })
    test('T5b capWarnings 含 branchId=1(红) → false', () => {
      const capWarnings = [{ branchId: 1, riskLevel: '红' }]
      expect(_isCapacityAvailable(1, capWarnings)).toBe(false)
    })
    test('T5c capWarnings 不含 branchId=2 → true', () => {
      const capWarnings = [{ branchId: 1, riskLevel: '红' }]
      expect(_isCapacityAvailable(2, capWarnings)).toBe(true)
    })
    test('T5d transWarnings 含 branchId=1(黄) → false', () => {
      const transWarnings = [{ branchId: 1, riskLevel: '黄' }]
      expect(_isTransportAvailable(1, transWarnings)).toBe(false)
    })
  })

  // ===== T4 (成本对比无距离): _calcComprehensiveSuggestions 在无 costOpts 时返回空数组 =====
  describe('_calcComprehensiveSuggestions', () => {
    test('空 costOpts + 无告警 → 返回空数组', () => {
      const plans = [{ id: 1, branchId: 1, projectName: 'P1', plannedSendTime: '08:00' }]
      const result = _calcComprehensiveSuggestions(plans, [], [], [])
      expect(result).toEqual([])
    })

    test('有 capWarnings 红 + costOpts 提供 available 替代站 → 生成改派建议', () => {
      const plans = [{ id: 1, branchId: 1, projectName: 'P1', plannedSendTime: '08:00' }]
      const capWarnings = [{ branchId: 1, riskLevel: '红', overloadPercent: 50 }]
      const costOpts = [{
        planId: 1, projectName: 'P1',
        alternatives: [{ branchId: 2, branchName: 'B2', savingPerM3: 3 }]
      }]
      const result = _calcComprehensiveSuggestions(plans, capWarnings, [], costOpts)
      expect(result).toHaveLength(1)
      expect(result[0].suggestions[0].type).toBe('change_branch')
      expect(result[0].suggestions[0].to).toBe(2)
    })
  })
})
