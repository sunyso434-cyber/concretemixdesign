// src/main/services/__tests__/DailyPlanService.test.js
// 2026-08-23 清理：原为裸 assert 脚本（自定义 run() + process.exitCode），jest 识别为 0 个用例
// 直接报 "must contain at least one test" —— 改写为标准 jest 用例（逻辑与断言原样保留）
const DailyPlanService = require('../DailyPlanService')
const { deriveStatus, deriveOverBudget } = DailyPlanService

describe('DailyPlanService status 派生值（2.8：从 Service import，非副本）', () => {
  test('executedVolume=0 → planned', () => {
    expect(deriveStatus(0, 100)).toBe('planned')
  })

  test('0<executedVolume<volume → executing', () => {
    expect(deriveStatus(50, 100)).toBe('executing')
  })

  test('executedVolume>=volume → completed', () => {
    expect(deriveStatus(100, 100)).toBe('completed')
  })

  test('executedVolume>volume → completed + overBudget', () => {
    expect(deriveStatus(120, 100)).toBe('completed')
    expect(deriveOverBudget(120, 100)).toBe(true)
  })

  test('删车次后executedVolume<volume → 自动回退到executing', () => {
    // 派生值天然支持回退
    expect(deriveStatus(80, 100)).toBe('executing')
  })
})
