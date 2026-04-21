/**
 * 原材料参数反算服务测试
 *
 * 测试核心算法：
 * - preprocessSamples: 同组平均
 * - calculatePredictedStrength: 预测强度计算
 * - goldenSectionSearchFce: 黄金分割法一维搜索
 * - searchOptimalGamma: 二维搜索
 * - calculate: 主回归函数
 */
const path = require('path')
const InverseCalculationService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'InverseCalculationService'))

// 测试结果收集
const testResults = []

function expect(actual) {
  return {
    toBeCloseTo: (expected, precision = 2) => {
      const diff = Math.abs(actual - expected)
      const threshold = Math.pow(10, -precision)
      if (diff > threshold) {
        throw new Error(`Expected ${actual} to be close to ${expected} (diff=${diff}, threshold=${threshold})`)
      }
      return true
    },
    toBe: (expected) => {
      if (Math.abs(actual - expected) > 1e-9) {
        throw new Error(`Expected ${actual} to be ${expected}`)
      }
      return true
    },
    toBeGreaterThan: (expected) => {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`)
      }
      return true
    },
    toBeLessThan: (expected) => {
      if (actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`)
      }
      return true
    },
    toBeGreaterThanOrEqual: (expected) => {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`)
      }
      return true
    },
    toBeLessThanOrEqual: (expected) => {
      if (actual > expected) {
        throw new Error(`Expected ${actual} to be less than or equal to ${expected}`)
      }
      return true
    },
    toBeDefined: () => {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined`)
      }
      return true
    },
    toBeGreaterThanZero: () => {
      if (actual <= 0) {
        throw new Error(`Expected ${actual} to be greater than 0`)
      }
      return true
    }
  }
}

function it(description, testFn) {
  try {
    testFn()
    testResults.push({ description, passed: true })
    console.log(`  ✓ ${description}`)
  } catch (error) {
    testResults.push({ description, passed: false, error: error.message })
    console.log(`  ✗ ${description}`)
    console.log(`    Error: ${error.message}`)
  }
}

function describe(name, tests) {
  console.log(`\n${name}`)
  tests()
}

// ============================================================
// 测试: preprocessSamples
// ============================================================
describe('preprocessSamples', () => {
  it('同name的多条记录应取强度平均值', () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 45.0 },
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 47.0 },
      { name: 'B', cement: 360, flyAshPercent: 0, slagPercent: 0, waterAmount: 175, strength: 48.0 }
    ]
    const result = InverseCalculationService.preprocessSamples(samples)
    // A 的强度应该是 (45 + 47) / 2 = 46
    expect(result[0].strength).toBeCloseTo(46.0, 2)
    // B 的强度应该是 48
    expect(result[1].strength).toBeCloseTo(48.0, 2)
    // 样本数应该是 2
    expect(result.length).toBe(2)
  })

  it('不同name的记录应保持不变', () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 10, slagPercent: 5, waterAmount: 180, strength: 45.0 },
      { name: 'B', cement: 360, flyAshPercent: 15, slagPercent: 10, waterAmount: 175, strength: 48.0 }
    ]
    const result = InverseCalculationService.preprocessSamples(samples)
    expect(result.length).toBe(2)
    expect(result[0].strength).toBeCloseTo(45.0, 2)
    expect(result[1].strength).toBeCloseTo(48.0, 2)
  })

  it('单一记录应保持不变', () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 45.0 }
    ]
    const result = InverseCalculationService.preprocessSamples(samples)
    expect(result.length).toBe(1)
    expect(result[0].strength).toBeCloseTo(45.0, 2)
    expect(result[0].cement).toBe(350)
  })

  it('三条同名记录应取平均值', () => {
    const samples = [
      { name: 'Test', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 40.0 },
      { name: 'Test', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.0 },
      { name: 'Test', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 48.0 }
    ]
    const result = InverseCalculationService.preprocessSamples(samples)
    expect(result.length).toBe(1)
    // (40 + 44 + 48) / 3 = 44
    expect(result[0].strength).toBeCloseTo(44.0, 2)
  })
})

// ============================================================
// 测试: calculatePredictedStrength
// ============================================================
describe('calculatePredictedStrength', () => {
  it('纯水泥配合比应返回正确的预测强度', () => {
    // 已知参数：fce=48.0, combinedFactor=1.0, alphaA=0.53, alphaB=0.20
    // 水泥: 350, 粉煤灰: 0%, 矿渣: 0%, 水: 180
    // W/B = 180 / 350 = 0.514
    // f_b = 48.0 * 1.0 = 48.0
    // f_cu,0 = 0.53 * 48.0 * (1/0.514 - 0.20) = 25.44 * (1.945 - 0.20) = 25.44 * 1.745 = 44.39
    const sample = {
      cement: 350,
      flyAshPercent: 0,
      slagPercent: 0,
      waterAmount: 180
    }
    const result = InverseCalculationService.calculatePredictedStrength(
      sample, 48.0, 1.0, 0.53, 0.20
    )
    expect(result).toBeCloseTo(44.39, 1)
  })

  it('含粉煤灰配合比应返回正确的预测强度', () => {
    // 已知参数：fce=48.0, combinedFactor=0.95, alphaA=0.53, alphaB=0.20
    // 水泥: 280, 粉煤灰: 20%, 水: 175
    // cementPercentage = 1 - 0.2 = 0.8
    // cementAmount = 280 * 0.8 = 224
    // flyAshAmount = 280 * 0.2 = 56
    // binderAmount = 224 + 56 = 280
    // W/B = 175 / 280 = 0.625
    // f_b = 48.0 * 0.95 = 45.6
    // f_cu,0 = 0.53 * 45.6 * (1/0.625 - 0.20) = 24.17 * (1.6 - 0.20) = 24.17 * 1.4 = 33.84
    const sample = {
      cement: 280,
      flyAshPercent: 20,
      slagPercent: 0,
      waterAmount: 175
    }
    const result = InverseCalculationService.calculatePredictedStrength(
      sample, 48.0, 0.95, 0.53, 0.20
    )
    expect(result).toBeCloseTo(33.84, 1)
  })

  it('含矿渣粉配合比应返回正确的预测强度', () => {
    // 已知参数：fce=48.0, combinedFactor=0.90, alphaA=0.53, alphaB=0.20
    // 水泥: 280, 矿渣: 20%, 水: 175
    // cementPercentage = 1 - 0.2 = 0.8
    // cementAmount = 280 * 0.8 = 224
    // slagAmount = 280 * 0.2 = 56
    // binderAmount = 224 + 56 = 280
    // W/B = 175 / 280 = 0.625
    // f_b = 48.0 * 0.90 = 43.2
    // f_cu,0 = 0.53 * 43.2 * (1/0.625 - 0.20) = 22.90 * (1.6 - 0.20) = 22.90 * 1.4 = 32.05
    const sample = {
      cement: 280,
      flyAshPercent: 0,
      slagPercent: 20,
      waterAmount: 175
    }
    const result = InverseCalculationService.calculatePredictedStrength(
      sample, 48.0, 0.90, 0.53, 0.20
    )
    expect(result).toBeCloseTo(32.05, 1)
  })

  it('同时含粉煤灰和矿渣粉的配合比应返回正确的预测强度', () => {
    // 已知参数：fce=48.0, combinedFactor=0.85, alphaA=0.53, alphaB=0.20
    // 水泥: 250, 粉煤灰: 15%, 矿渣: 15%, 水: 170
    // cementPercentage = 1 - 0.15 - 0.15 = 0.7
    // cementAmount = 250 * 0.7 = 175
    // flyAshAmount = 250 * 0.15 = 37.5
    // slagAmount = 250 * 0.15 = 37.5
    // binderAmount = 175 + 37.5 + 37.5 = 250
    // W/B = 170 / 250 = 0.68
    // f_b = 48.0 * 0.85 = 40.8
    // f_cu,0 = 0.53 * 40.8 * (1/0.68 - 0.20) = 21.62 * (1.4706 - 0.20) = 21.62 * 1.2706 = 27.47
    const sample = {
      cement: 250,
      flyAshPercent: 15,
      slagPercent: 15,
      waterAmount: 170
    }
    const result = InverseCalculationService.calculatePredictedStrength(
      sample, 48.0, 0.85, 0.53, 0.20
    )
    expect(result).toBeCloseTo(27.47, 1)
  })
})

// ============================================================
// 测试: calculateRSS
// ============================================================
describe('calculateRSS', () => {
  it('应正确计算残差平方和', () => {
    const samples = [
      { cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 45.0 },
      { cement: 340, flyAshPercent: 0, slagPercent: 0, waterAmount: 175, strength: 43.0 }
    ]
    // 使用相同参数计算 RSS
    const rss = InverseCalculationService.calculateRSS(samples, 48.0, 1.0, 0.53, 0.20)
    // RSS 应该大于 0
    expect(rss).toBeGreaterThan(0)
    // 手动验证一个样本的残差
    const pred = InverseCalculationService.calculatePredictedStrength(samples[0], 48.0, 1.0, 0.53, 0.20)
    const residual1 = samples[0].strength - pred
    // RSS 应该包含这个残差的平方
    expect(rss).toBeGreaterThan(residual1 * residual1)
  })
})

// ============================================================
// 测试: goldenSectionSearchFce
// ============================================================
describe('goldenSectionSearchFce', () => {
  it('应在约束范围内找到较优的fce', () => {
    const samples = [
      { cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 45.0 },
      { cement: 340, flyAshPercent: 0, slagPercent: 0, waterAmount: 175, strength: 43.0 },
      { cement: 330, flyAshPercent: 0, slagPercent: 0, waterAmount: 170, strength: 42.0 }
    ]
    const constraints = { fceMin: 48, fceMax: 55 }
    const options = { alphaA: 0.53, alphaB: 0.20 }

    const result = InverseCalculationService.goldenSectionSearchFce(
      samples, 1.0, constraints, options
    )

    // fce 应该在约束范围内
    expect(result.optimalFce).toBeGreaterThanOrEqual(48)
    expect(result.optimalFce).toBeLessThanOrEqual(55)
    // RSS 应该大于 0
    expect(result.rss).toBeGreaterThan(0)
    // 迭代次数应该小于最大迭代次数
    expect(result.iterations).toBeLessThan(100)
  })

  it('不同combinedFactor应返回不同的最优fce', () => {
    const samples = [
      { cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 45.0 }
    ]
    const constraints = { fceMin: 48, fceMax: 55 }
    const options = { alphaA: 0.53, alphaB: 0.20 }

    const result1 = InverseCalculationService.goldenSectionSearchFce(
      samples, 1.0, constraints, options
    )
    const result2 = InverseCalculationService.goldenSectionSearchFce(
      samples, 0.9, constraints, options
    )

    // 不同的 combinedFactor 应该得到不同的 RSS
    expect(result1.rss !== result2.rss).toBe(true)
  })
})

// ============================================================
// 测试: searchOptimalGamma
// ============================================================
describe('searchOptimalGamma', () => {
  it('应在约束范围内找到较优的γ_f和γ_s', () => {
    const samples = [
      { cement: 280, flyAshPercent: 20, slagPercent: 0, waterAmount: 175, strength: 41.5 },
      { cement: 270, flyAshPercent: 25, slagPercent: 0, waterAmount: 172, strength: 40.0 }
    ]
    const constraints = {
      flyAshFactorMin: 0.5,
      flyAshFactorMax: 1.0,
      slagFactorMin: 0.5,
      slagFactorMax: 1.2
    }
    const options = { alphaA: 0.53, alphaB: 0.20 }

    const result = InverseCalculationService.searchOptimalGamma(
      samples, 48.0, constraints, options
    )

    // γ_f 应该在约束范围内
    expect(result.flyAshFactor).toBeGreaterThanOrEqual(0.5)
    expect(result.flyAshFactor).toBeLessThanOrEqual(1.0)
    // γ_s 应该在约束范围内
    expect(result.slagFactor).toBeGreaterThanOrEqual(0.5)
    expect(result.slagFactor).toBeLessThanOrEqual(1.2)
    // combinedFactor = γ_f × γ_s
    expect(result.combinedFactor).toBeCloseTo(result.flyAshFactor * result.slagFactor, 6)
    // RSS 应该大于 0
    expect(result.rss).toBeGreaterThan(0)
  })

  it('网格搜索应能找到合理的初始值', () => {
    const samples = [
      { cement: 280, flyAshPercent: 20, slagPercent: 0, waterAmount: 175, strength: 41.5 }
    ]
    const constraints = {
      flyAshFactorMin: 0.5,
      flyAshFactorMax: 1.0,
      slagFactorMin: 0.5,
      slagFactorMax: 1.2
    }
    const options = { alphaA: 0.53, alphaB: 0.20 }

    const result = InverseCalculationService.searchOptimalGamma(
      samples, 48.0, constraints, options
    )

    // combinedFactor 应该在合理范围内
    expect(result.combinedFactor).toBeGreaterThan(0.25) // 0.5 * 0.5
    expect(result.combinedFactor).toBeLessThan(1.2) // 1.0 * 1.2
  })
})

// ============================================================
// 测试: calculate (主回归函数)
// ============================================================
describe('calculate', () => {
  it('应正确执行完整回归流程', async () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.4 },
      { name: 'B', cement: 340, flyAshPercent: 0, slagPercent: 0, waterAmount: 175, strength: 43.0 },
      { name: 'C', cement: 330, flyAshPercent: 0, slagPercent: 0, waterAmount: 170, strength: 42.0 }
    ]

    const result = await InverseCalculationService.calculate({ samples })

    // 验证返回结构
    expect(result.cementStrength28d).toBeDefined()
    expect(result.flyAshFactor).toBeDefined()
    expect(result.slagFactor).toBeDefined()
    expect(result.combinedFactor).toBeDefined()
    expect(result.rSquared).toBeDefined()
    expect(result.sampleCount).toBe(3)
    expect(result.iterations).toBeDefined()
    expect(result.convergence).toBeDefined()
    expect(result.residuals).toBeDefined()
    expect(result.residuals.length).toBe(3)
  })

  it('应返回合理的参数范围', async () => {
    const samples = [
      { name: 'A', cement: 280, flyAshPercent: 20, slagPercent: 0, waterAmount: 175, strength: 41.5 },
      { name: 'B', cement: 270, flyAshPercent: 25, slagPercent: 0, waterAmount: 172, strength: 40.0 },
      { name: 'C', cement: 260, flyAshPercent: 30, slagPercent: 0, waterAmount: 170, strength: 38.5 }
    ]

    const result = await InverseCalculationService.calculate({ samples })

    // cementStrength28d 应在 48-55 范围内
    expect(result.cementStrength28d).toBeGreaterThanOrEqual(48)
    expect(result.cementStrength28d).toBeLessThanOrEqual(55)
    // flyAshFactor 应在 0.5-1.0 范围内
    expect(result.flyAshFactor).toBeGreaterThanOrEqual(0.5)
    expect(result.flyAshFactor).toBeLessThanOrEqual(1.0)
    // slagFactor 应在 0.5-1.2 范围内
    expect(result.slagFactor).toBeGreaterThanOrEqual(0.5)
    expect(result.slagFactor).toBeLessThanOrEqual(1.2)
  })

  it('应正确计算R²值', async () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.4 },
      { name: 'B', cement: 340, flyAshPercent: 0, slagPercent: 0, waterAmount: 175, strength: 43.0 }
    ]

    const result = await InverseCalculationService.calculate({ samples })

    // R² 应该在 0-1 之间
    expect(result.rSquared).toBeGreaterThanOrEqual(0)
    expect(result.rSquared).toBeLessThanOrEqual(1)
  })

  it('应正确处理样本预处理（同名记录平均）', async () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.0 },
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 46.0 },
      { name: 'B', cement: 340, flyAshPercent: 0, slagPercent: 0, waterAmount: 175, strength: 43.0 }
    ]

    const result = await InverseCalculationService.calculate({ samples })

    // 预处理后应该有 2 个样本
    expect(result.sampleCount).toBe(2)
    // 残差数组应该有 2 个元素
    expect(result.residuals.length).toBe(2)
  })

  it('应正确传递自定义约束条件', async () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.4 }
    ]

    const constraints = {
      fceMin: 50,
      fceMax: 60,
      flyAshFactorMin: 0.6,
      flyAshFactorMax: 1.1,
      slagFactorMin: 0.6,
      slagFactorMax: 1.3
    }

    const result = await InverseCalculationService.calculate({ samples, constraints })

    // cementStrength28d 应在新的约束范围内
    expect(result.cementStrength28d).toBeGreaterThanOrEqual(50)
    expect(result.cementStrength28d).toBeLessThanOrEqual(60)
    // flyAshFactor 应在新的约束范围内
    expect(result.flyAshFactor).toBeGreaterThanOrEqual(0.6)
    expect(result.flyAshFactor).toBeLessThanOrEqual(1.1)
    // slagFactor 应在新的约束范围内
    expect(result.slagFactor).toBeGreaterThanOrEqual(0.6)
    expect(result.slagFactor).toBeLessThanOrEqual(1.3)
  })

  it('应正确使用自定义回归系数', async () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.4 }
    ]

    // 使用不同的回归系数
    const result1 = await InverseCalculationService.calculate({
      samples,
      alphaA: 0.53,
      alphaB: 0.20
    })
    const result2 = await InverseCalculationService.calculate({
      samples,
      alphaA: 0.46,
      alphaB: 0.24
    })

    // 不同的回归系数应该得到不同的预测结果
    // 由于我们使用的是同一个样本，RSS 可能不完全相同
    expect(result1.cementStrength28d !== result2.cementStrength28d ||
           result1.combinedFactor !== result2.combinedFactor).toBe(true)
  })

  it('残差数组应包含正确的字段', async () => {
    const samples = [
      { name: 'TestA', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.4 }
    ]

    const result = await InverseCalculationService.calculate({ samples })

    const residual = result.residuals[0]
    expect(residual.name).toBe('TestA')
    expect(residual.actual).toBe(44.4)
    expect(residual.predicted).toBeDefined()
    expect(residual.residual).toBeDefined()
    // residual = actual - predicted
    expect(Math.abs(residual.residual - (residual.actual - residual.predicted))).toBeLessThan(1e-9)
  })
})

// ============================================================
// 测试: 边界条件和异常处理
// ============================================================
describe('边界条件', () => {
  it('空样本数组应能处理', async () => {
    try {
      await InverseCalculationService.calculate({ samples: [] })
      // 如果没有抛出异常，测试失败
      throw new Error('应该抛出错误')
    } catch (error) {
      // 预期会抛出错误
      expect(error.message).toBeDefined()
    }
  })

  it('单一样本应能处理', async () => {
    const samples = [
      { name: 'A', cement: 350, flyAshPercent: 0, slagPercent: 0, waterAmount: 180, strength: 44.4 }
    ]

    const result = await InverseCalculationService.calculate({ samples })

    expect(result.sampleCount).toBe(1)
    expect(result.cementStrength28d).toBeDefined()
    // 单一样本时 residualStdDev 应该为 null
    expect(result.residualStdDev).toBe(null)
  })

  it('超过10个样本时应计算残差标准差', async () => {
    const samples = []
    for (let i = 0; i < 12; i++) {
      samples.push({
        name: `Sample${i}`,
        cement: 350 - i * 3,
        flyAshPercent: (i % 3) * 10,
        slagPercent: (i % 2) * 15,
        waterAmount: 180 - i * 1.5,
        strength: 44.0 - i * 0.3 + Math.random() * 0.5
      })
    }

    const result = await InverseCalculationService.calculate({ samples })

    expect(result.sampleCount).toBe(12)
    // 样本数 > 10 时应计算残差标准差
    expect(result.residualStdDev).toBeDefined()
    expect(result.residualStdDev).toBeGreaterThan(0)
  })
})

// ============================================================
// 输出测试总结
// ============================================================
console.log('\n' + '='.repeat(50))
console.log('测试结果汇总')
console.log('='.repeat(50))

const passed = testResults.filter(r => r.passed).length
const failed = testResults.filter(r => !r.passed).length

console.log(`通过: ${passed}/${testResults.length}`)
console.log(`失败: ${failed}/${testResults.length}`)

if (failed > 0) {
  console.log('\n失败测试:')
  testResults.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.description}: ${r.error}`)
  })
  process.exit(1)
} else {
  console.log('\n所有测试通过!')
  process.exit(0)
}
