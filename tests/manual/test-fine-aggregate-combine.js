// 独立测试：验证细骨料组合逻辑（有完整筛余数据与无完整筛余）

function finenessModulusFromCumulative(combinedSieve) {
  const g = (k) => parseFloat(combinedSieve[k]) || 0
  const a1 = g('sieve_4_75')
  const denominator = 100 - a1
  if (denominator === 0) return 0
  return (g('sieve_2_36') + g('sieve_1_18') + g('sieve_0_60') + g('sieve_0_30') + g('sieve_0_15') - 5 * a1) / denominator
}

function calculateOptimalFineAggregateRatio(fineAggregates) {
  if (!Array.isArray(fineAggregates) || fineAggregates.length <= 1) {
    const result = (fineAggregates || []).map((aggregate, index) => ({ aggregate, ratio: 1 / Math.max(1, fineAggregates.length) }))
    result.combinedFinenessModulus = fineAggregates && fineAggregates.length === 1 ? (fineAggregates[0].finenessModulus || 2.7) : 2.7
    result.combinedMbValue = fineAggregates && fineAggregates.length === 1 ? (fineAggregates[0].mbValue || 0.5) : 0.5
    return result
  }

  const targetFinenessModulus = 2.7
  const steps = 10
  let bestCombination = null
  let minDifference = Infinity

  const sieveKeys = ['sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15']
  const hasDetailedSieve = fineAggregates.every(agg => {
    return sieveKeys.every(k => {
      const v = agg && agg[k]
      const n = parseFloat(v)
      return Number.isFinite(n)
    })
  })

  const generateCombinations = (index, currentRatios) => {
    if (index === fineAggregates.length - 1) {
      const remainingRatio = 1 - currentRatios.reduce((sum, r) => sum + r, 0)
      if (remainingRatio < 0 || remainingRatio > 1) return

      const ratios = [...currentRatios, remainingRatio]

      let combinedFinenessModulus = 0
      let combinedMbValue = 0

      if (hasDetailedSieve) {
        const combinedSieve = {}
        for (const key of sieveKeys) combinedSieve[key] = 0

        for (let i = 0; i < fineAggregates.length; i++) {
          const aggregate = fineAggregates[i]
          const ratio = ratios[i]
          for (const key of sieveKeys) {
            const v = parseFloat(aggregate[key]) || 0
            combinedSieve[key] += v * ratio
          }
          combinedMbValue += (aggregate.mbValue || 0.5) * ratio
        }

        combinedFinenessModulus = finenessModulusFromCumulative(combinedSieve)
      } else {
        for (let i = 0; i < fineAggregates.length; i++) {
          const aggregate = fineAggregates[i]
          const ratio = ratios[i]
          combinedFinenessModulus += (aggregate.finenessModulus || 2.7) * ratio
          combinedMbValue += (aggregate.mbValue || 0.5) * ratio
        }
      }

      const difference = Math.abs(combinedFinenessModulus - targetFinenessModulus)

      if (difference < minDifference) {
        minDifference = difference
        bestCombination = { ratios, combinedFinenessModulus, combinedMbValue }
      }

      return
    }

    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps
      const remainingRatio = 1 - currentRatios.reduce((sum, r) => sum + r, 0) - ratio
      if (remainingRatio >= 0) {
        generateCombinations(index + 1, [...currentRatios, ratio])
      }
    }
  }

  generateCombinations(0, [])

  if (bestCombination) {
    const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: bestCombination.ratios[index] }))
    result.combinedFinenessModulus = bestCombination.combinedFinenessModulus
    result.combinedMbValue = bestCombination.combinedMbValue
    return result
  }

  const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
  const combinedFm = fineAggregates.reduce((s, agg) => s + ((agg.finenessModulus || 2.7) * (1 / fineAggregates.length)), 0)
  const combinedMb = fineAggregates.reduce((s, agg) => s + ((agg.mbValue || 0.5) * (1 / fineAggregates.length)), 0)
  result.combinedFinenessModulus = combinedFm
  result.combinedMbValue = combinedMb
  return result
}

function calculateCombinedFineAggregateParams(fineAggregates) {
  const optimalRatio = calculateOptimalFineAggregateRatio(fineAggregates)
  let combinedFinenessModulus = optimalRatio.combinedFinenessModulus
  let combinedMbValue = optimalRatio.combinedMbValue

  if (combinedFinenessModulus === undefined || combinedMbValue === undefined) {
    combinedFinenessModulus = 0
    combinedMbValue = 0
    for (const item of optimalRatio) {
      combinedFinenessModulus += (item.aggregate.finenessModulus || 2.7) * item.ratio
      combinedMbValue += (item.aggregate.mbValue || 0.5) * item.ratio
    }
  }

  return {
    finenessModulus: combinedFinenessModulus,
    mbValue: combinedMbValue,
    optimalRatio
  }
}

function approxEqual(a, b, tol = 1e-3) {
  return Math.abs(a - b) <= tol
}

// ---- Test cases ----
console.log('\n=== Test 1: 所有细骨料有完整筛余累计百分数（应使用筛余合成方法） ===')
const sand1 = {
  id: 1,
  name: '砂A',
  sieve_4_75: 50,
  sieve_2_36: 50,
  sieve_1_18: 60,
  sieve_0_60: 50,
  sieve_0_30: 40,
  sieve_0_15: 30,
  mbValue: 0.5,
  finenessModulus: 2.8
}
const sand2 = {
  id: 2,
  name: '砂B',
  sieve_4_75: 40,
  sieve_2_36: 40,
  sieve_1_18: 60,
  sieve_0_60: 60,
  sieve_0_30: 40,
  sieve_0_15: 20,
  mbValue: 0.5,
  finenessModulus: 2.6
}

const res1 = calculateCombinedFineAggregateParams([sand1, sand2])
console.log('optimalRatio:', res1.optimalRatio.map(i => ({ id: i.aggregate.id, ratio: i.ratio })))
console.log('combined finenessModulus:', res1.finenessModulus.toFixed(3))
console.log('combined mbValue:', res1.mbValue.toFixed(3))
const sieveKeys = ['sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15']
const blended1 = {}
for (const key of sieveKeys) {
  blended1[key] = res1.optimalRatio.reduce((s, item) => s + (parseFloat(item.aggregate[key]) || 0) * item.ratio, 0)
}
const fmFromBlend = finenessModulusFromCumulative(blended1)
console.assert(approxEqual(res1.finenessModulus, fmFromBlend, 1e-9), 'Test1 组合FM须等于合成累计筛余按JGJ52计算的FM')
const ratioSum = res1.optimalRatio.reduce((s, i) => s + i.ratio, 0)
console.assert(approxEqual(ratioSum, 1, 1e-9), 'Test1 配比之和应为1')
console.log('Test1 断言通过（若无错误输出）')

// ---- Test 2: 含缺失筛余数据的砂，回退到按 finenessModulus 加权平均 ----
console.log('\n=== Test 2: 部分砂缺少筛余数据（应按细度模数加权平均） ===')
const sand3 = { id: 3, name: '砂C', finenessModulus: 2.9, mbValue: 0.6 }
const sand4 = { id: 4, name: '砂D', finenessModulus: 2.5, mbValue: 0.4 }

const res2 = calculateCombinedFineAggregateParams([sand3, sand4])
console.log('optimalRatio:', res2.optimalRatio.map(i => ({ id: i.aggregate.id, ratio: i.ratio })))
console.log('combined finenessModulus:', res2.finenessModulus.toFixed(3))
console.log('combined mbValue:', res2.mbValue.toFixed(3))
console.assert(approxEqual(res2.finenessModulus, 2.7, 1e-2), 'Test2 期望组合细度模数约为 2.7')
console.log('Test2 断言通过（若无错误输出）')

// ---- Test 3: 单一砂返回自身值 ----
console.log('\n=== Test 3: 单一砂 ===')
const res3 = calculateCombinedFineAggregateParams([sand1])
console.log('combined finenessModulus:', res3.finenessModulus.toFixed(3))
console.assert(approxEqual(res3.finenessModulus, 2.8, 1e-6), 'Test3 单一砂应返回自身细度模数')
console.log('Test3 断言通过')

console.log('\n所有测试完成')
