/**
 * 温度场数值解服务测试
 * 基于 GB 50496-2018《大体积混凝土施工标准》
 *
 * 测试核心算法: calculateAdiabaticTemp 和 solveTridiagonal
 */
const path = require('path')
const MassConcreteTemperatureFieldService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'MassConcreteTemperatureFieldService'))

// 测试结果收集
const testResults = []

function expect(actual) {
  return {
    toBeCloseTo: (expected, precision = 2) => {
      const diff = Math.abs(actual - expected)
      const threshold = Math.pow(10, -precision)
      if (diff > threshold) {
        throw new Error(`Expected ${actual} to be close to ${expected} (diff=${diff})`)
      }
      return true
    },
    toBe: (expected) => {
      if (actual !== expected) {
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
    toBeDefined: () => {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined`)
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
// 测试: calculateAdiabaticTemp 方法
// 公式: T_ad(τ) = T_0 × (1 - exp(-m×τ))
// ============================================================
describe('calculateAdiabaticTemp', () => {
  it('T_ad(0) 应为 0 (初始时刻无温升)', () => {
    const T0 = 50
    const m = 0.1
    const times = [0]
    const result = MassConcreteTemperatureFieldService.calculateAdiabaticTemp(T0, m, times)
    expect(result[0]).toBeCloseTo(0, 2)
  })

  it('T_ad(1) = T_0 × (1 - exp(-m×1)) ≈ 4.76 (T0=50, m=0.1)', () => {
    const T0 = 50
    const m = 0.1
    const times = [1]
    const result = MassConcreteTemperatureFieldService.calculateAdiabaticTemp(T0, m, times)
    // T_ad(1) = 50 * (1 - exp(-0.1)) = 50 * 0.0951626 = 4.758
    expect(result[0]).toBeCloseTo(4.76, 2)
  })

  it('T_ad(10) 应趋近于 T0 (当时间足够长时)', () => {
    const T0 = 50
    const m = 0.3
    const times = [10, 20, 30]
    const result = MassConcreteTemperatureFieldService.calculateAdiabaticTemp(T0, m, times)
    // T_ad(10) = 50 * (1 - exp(-3)) ≈ 47.5
    expect(result[0]).toBeCloseTo(47.5, 1)
    // T_ad(20) ≈ 49.88
    expect(result[1]).toBeCloseTo(49.88, 1)
    // T_ad(30) ≈ 49.98
    expect(result[2]).toBeCloseTo(49.98, 1)
  })

  it('绝热温升公式应满足单调递增', () => {
    const T0 = 50
    const m = 0.1
    const times = [0, 1, 2, 3, 5, 10]
    const result = MassConcreteTemperatureFieldService.calculateAdiabaticTemp(T0, m, times)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1])
    }
  })

  it('绝热温升不应超过最终温升 T0', () => {
    const T0 = 50
    const m = 0.3
    const times = [0, 1, 5, 10, 20, 100]
    const result = MassConcreteTemperatureFieldService.calculateAdiabaticTemp(T0, m, times)
    for (const temp of result) {
      expect(temp).toBeLessThan(T0)
    }
  })

  it('应正确处理时间序列', () => {
    const T0 = 30
    const m = 0.5
    const times = [0, 1, 2, 3, 4, 5]
    const result = MassConcreteTemperatureFieldService.calculateAdiabaticTemp(T0, m, times)
    expect(result.length).toBe(6)
  })
})

// ============================================================
// 测试: solveTridiagonal 方法 (追赶法)
// ============================================================
describe('solveTridiagonal', () => {
  it('应正确求解简单三对角方程组 (解=[1,1,1])', () => {
    // 方程组:
    // | 4 -1  0 |   | x0 |   | 3 |
    // | -1  4 -1 | × | x1 | = | 2 |
    // |  0 -1  4 |   | x2 |   | 3 |
    // 解: x = [1, 1, 1]
    const a = [0, -1, -1]  // 下对角 (a[0]不使用)
    const b = [4, 4, 4]    // 主对角
    const c = [-1, -1, 0]  // 上对角 (c[n-1]不使用)
    const d = [3, 2, 3]    // 右端向量

    const result = MassConcreteTemperatureFieldService.solveTridiagonal(a, b, c, d)
    expect(result[0]).toBeCloseTo(1, 2)
    expect(result[1]).toBeCloseTo(1, 2)
    expect(result[2]).toBeCloseTo(1, 2)
  })

  it('应正确求解非对称三对角方程组', () => {
    // 方程组:
    // | 4  1  0 |   | x0 |   | 5 |
    // | 2  5  2 | × | x1 | = | 9 |
    // | 0  3  7 |   | x2 |   |10 |
    const a = [0, 2, 3]
    const b = [4, 5, 7]
    const c = [1, 2, 0]
    const d = [5, 9, 10]

    const result = MassConcreteTemperatureFieldService.solveTridiagonal(a, b, c, d)
    // 手算验证: x0=1, x1=1, x2=1 是解
    expect(result[0]).toBeCloseTo(1, 2)
    expect(result[1]).toBeCloseTo(1, 2)
    expect(result[2]).toBeCloseTo(1, 2)
  })

  it('应正确求解对角占优的三对角方程组', () => {
    // 对角占优系统 (数值稳定)
    // | 10  -1   0 |   | x0 |   | 9 |
    // | -1  10  -1 | × | x1 | = | 8 |
    // |  0  -1  10 |   | x2 |   | 9 |
    const a = [0, -1, -1]
    const b = [10, 10, 10]
    const c = [-1, -1, 0]
    const d = [9, 8, 9]

    const result = MassConcreteTemperatureFieldService.solveTridiagonal(a, b, c, d)
    expect(result[0]).toBeCloseTo(1, 2)
    expect(result[1]).toBeCloseTo(1, 2)
    expect(result[2]).toBeCloseTo(1, 2)
  })

  it('应正确求解更大规模的三对角方程组', () => {
    // 5x5 三对角矩阵
    // | 4 -1  0  0  0 |   | x0 |   | 3 |
    // | -1  4 -1  0  0 |   | x1 |   | 2 |
    // |  0 -1  4 -1  0 | × | x2 | = | 2 |
    // |  0  0 -1  4 -1 |   | x3 |   | 2 |
    // |  0  0  0 -1  4 |   | x4 |   | 3 |
    const a = [0, -1, -1, -1, -1]
    const b = [4, 4, 4, 4, 4]
    const c = [-1, -1, -1, -1, 0]
    const d = [3, 2, 2, 2, 3]

    const result = MassConcreteTemperatureFieldService.solveTridiagonal(a, b, c, d)
    // 验证解: 全为 1
    for (let i = 0; i < 5; i++) {
      expect(result[i]).toBeCloseTo(1, 2)
    }
  })

  it('应抛出错误当主元接近零时', () => {
    // 病态方程组: 主元非常小
    const a = [0, -1, -1]
    const b = [1e-16, 1e-16, 1e-16]  // 极小的主对角元素
    const c = [-1, -1, 0]
    const d = [1, 2, 3]

    let threw = false
    try {
      MassConcreteTemperatureFieldService.solveTridiagonal(a, b, c, d)
    } catch (e) {
      threw = true
    }
    expect(threw).toBe(true)
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