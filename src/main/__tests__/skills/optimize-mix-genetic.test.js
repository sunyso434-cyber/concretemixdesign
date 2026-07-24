/**
 * Task 5 端到端测试 — optimize_mix_genetic skill
 *
 * 测试覆盖：
 *   1. C30 正常场景（mock GA 返回 5 个方案 → Top3 取 3 个）
 *   2. 水泥缺失报错
 *   3. 水缺失报错
 *   4. Top3 不足 3 个不凑数（mock GA 返回 2 个方案 → top3.length === 2）
 *
 * Claude Code #14：mock DB，不依赖真实测试数据库
 */

jest.mock('../../../main/services/MaterialService', () => ({
  getAllMaterials: jest.fn().mockResolvedValue([
    { id: 1, name: 'P.O 42.5', type: 'cement', price: 480, density: 3.1 },
    { id: 7, name: '机制砂', type: 'sand', price: 80, density: 2.65 },
    { id: 9, name: '碎石5-25', type: 'stone', price: 90, density: 2.70 },
    { id: 10, name: '聚羧酸A', type: 'sp', price: 3500, density: 1.05 },
    { id: 11, name: '自来水', type: 'water', price: 5, density: 1.00 }
  ])
}))

jest.mock('../../../main/services/XGBoostPredictionService', () => ({
  predict: jest.fn().mockResolvedValue({
    predictions: {
      strength28d: { value: 40 },
      density: { value: 2400 },
      superplasticizer_dosage: { value: 1.2 }
    }
  })
}))

// mock GeneticOptimizer，让 Top3 测试可控
jest.mock('../../../main/services/GeneticOptimizer', () => {
  return jest.fn().mockImplementation(() => ({ run: jest.fn() }))
})
const GeneticOptimizer = require('../../../main/services/GeneticOptimizer')

// 测试数据构造函数
function makeMockSolution(fitness) {
  return {
    genes: { wb: 0.5, sandRatio: 40, spDosage: 1.5 },
    fitness,
    materials: [
      { type: 'cement', materialId: 1, mass: 350, density: 3100 },
      { type: 'water', materialId: 11, mass: 175, density: 1000 },
      { type: 'sand1', materialId: 7, mass: 750, density: 2650 },
      { type: 'stone1', materialId: 9, mass: 1050, density: 2700 },
      { type: 'sp', materialId: 10, mass: 7, density: 1050 }
    ],
    predictions: { strength28d: 40, density: 2332, spDosage: 1.2 }
  }
}

function defaultGaResult(n) {
  return {
    bestSolutions: Array.from({ length: n }, (_, i) => makeMockSolution(280 + i * 10)),
    stats: { generationsRun: 100, converged: true, time: 800 }
  }
}

const optimizeMixGenetic = require('../../../main/skills/optimize-mix-genetic')

describe('optimize_mix_genetic skill', () => {
  beforeEach(() => {
    // 默认 GA 返回 5 个方案（正常场景）
    GeneticOptimizer.mockImplementation(() => ({
      run: jest.fn().mockResolvedValue(defaultGaResult(5))
    }))
  })

  test('C30 端到端', async () => {
    const result = await optimizeMixGenetic.execute({
      cementIds: [1],
      sandIds: [7],
      stoneIds: [9],
      spIds: [10],
      waterIds: [11],
      targetStrength: 38,
      slump: 200
    })
    expect(result.success).toBe(true)
    expect(result.data.topSolutions).toBeDefined()
    expect(result.data.topSolutions.length).toBeGreaterThan(0)
    expect(result.data.top3).toBeDefined()
    expect(result.data.top3.length).toBe(3)
    expect(result.data.gaStats).toBeDefined()
  })

  test('水泥缺失报错', async () => {
    const result = await optimizeMixGenetic.execute({
      cementIds: [],
      sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [11],
      targetStrength: 38, slump: 200
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('水泥')
  })

  test('水缺失报错', async () => {
    const result = await optimizeMixGenetic.execute({
      cementIds: [1], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [],
      targetStrength: 38, slump: 200
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('水')
  })

  test('Top3 不足3个不凑数', async () => {
    GeneticOptimizer.mockImplementation(() => ({
      run: jest.fn().mockResolvedValue(defaultGaResult(2))
    }))
    const result = await optimizeMixGenetic.execute({
      cementIds: [1], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [11],
      targetStrength: 38, slump: 200, populationSize: 10, generations: 10
    })
    expect(result.data.top3.length).toBe(2)
  })
})
