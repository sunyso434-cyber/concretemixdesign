// 简化测试细骨料比例计算逻辑

function calculateOptimalFineAggregateRatio(fineAggregates, strength = 'C30', tempSettings = null) {
  if (!Array.isArray(fineAggregates) || fineAggregates.length <= 1) {
    const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
    // attach combined metrics for compatibility
    result.combinedFinenessModulus = fineAggregates.length === 1 ? (fineAggregates[0].finenessModulus || 2.7) : 2.7
    result.combinedMbValue = fineAggregates.length === 1 ? (fineAggregates[0].mbValue || 0.5) : 0.5
    return result
  }

  // 计算目标细度模数：C30为2.7，每5MPa强度等级变化，目标细度模数变化0.1
  const baseTargetFinenessModulus = tempSettings?.baseTargetFinenessModulus || 2.7
  const finenessModulusIncreasePerStrength = tempSettings?.finenessModulusIncreasePerStrength || 0.1
  const strengthNum = parseInt(strength.replace('C', ''))
  const baseStrength = 30
  const strengthDifference = strengthNum - baseStrength
  const targetFinenessModulus = baseTargetFinenessModulus + (strengthDifference / 5 * finenessModulusIncreasePerStrength)
  
  // 生成可能的比例组合（简化为等间隔的比例）
  const steps = 10 // 每个骨料的比例步数
  let bestCombination = null
  let minDifference = Infinity
  
  // 判断是否所有细骨料都具备详细的筛余累计百分数（用于按筛余合成级配）
  const sieveKeys = ['sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15']
  const hasDetailedSieve = fineAggregates.every(agg => {
    return sieveKeys.every(k => {
      const v = agg && agg[k]
      const n = parseFloat(v)
      return Number.isFinite(n)
    })
  })

  // 递归生成所有可能的比例组合
  const generateCombinations = (index, currentRatios) => {
    if (index === fineAggregates.length - 1) {
      // 最后一个骨料的比例由前面的比例决定
      const remainingRatio = 1 - currentRatios.reduce((sum, ratio) => sum + ratio, 0)
      if (remainingRatio < 0 || remainingRatio > 1) return
      
      const ratios = [...currentRatios, remainingRatio]
      
      // 计算组合后的细度模数
      let combinedFinenessModulus = 0
      let combinedMbValue = 0

      if (hasDetailedSieve) {
        // 使用每种砂的筛余累计百分数按比例合成后计算细度模数
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

        // 细度模数 = 各级筛余累计百分数之和 / 100
        const sieveSum = sieveKeys.reduce((s, k) => s + (combinedSieve[k] || 0), 0)
        combinedFinenessModulus = sieveSum / 100
      } else {
        // 回退：按各砂的细度模数加权平均
        for (let i = 0; i < fineAggregates.length; i++) {
          const aggregate = fineAggregates[i]
          const ratio = ratios[i]
          combinedFinenessModulus += (aggregate.finenessModulus || 2.7) * ratio
          combinedMbValue += (aggregate.mbValue || 0.5) * ratio
        }
      }
      
      // 计算与目标细度模数的差异
      const difference = Math.abs(combinedFinenessModulus - targetFinenessModulus)
      
      if (difference < minDifference) {
        minDifference = difference
        bestCombination = {
          ratios,
          combinedFinenessModulus,
          combinedMbValue
        }
      }
      
      return
    }
    
    // 为当前骨料生成可能的比例
    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps
      // 确保剩余的比例足够分配给其他骨料
      const remainingRatio = 1 - currentRatios.reduce((sum, r) => sum + r, 0) - ratio
      if (remainingRatio >= 0) {
        generateCombinations(index + 1, [...currentRatios, ratio])
      }
    }
  }
  
  // 开始生成组合
  generateCombinations(0, [])
  
  if (bestCombination) {
    const result = fineAggregates.map((aggregate, index) => ({
      aggregate,
      ratio: bestCombination.ratios[index]
    }))
    // attach computed metrics for callers
    result.combinedFinenessModulus = bestCombination.combinedFinenessModulus
    result.combinedMbValue = bestCombination.combinedMbValue
    return result
  }
  
  // 如果没有找到最佳组合，返回等比例
  const result = fineAggregates.map((aggregate, index) => ({ aggregate, ratio: 1 / fineAggregates.length }))
  // compute combined metrics for equal distribution
  const combinedFm = fineAggregates.reduce((s, agg) => s + ((agg.finenessModulus || 2.7) * (1 / fineAggregates.length)), 0)
  const combinedMb = fineAggregates.reduce((s, agg) => s + ((agg.mbValue || 0.5) * (1 / fineAggregates.length)), 0)
  result.combinedFinenessModulus = combinedFm
  result.combinedMbValue = combinedMb
  return result
}

// 测试数据
const sand1 = {id: 1, name: '机制砂', finenessModulus: 3.0, mbValue: 0.5};
const sand2 = {id: 2, name: '河砂', finenessModulus: 2.4, mbValue: 0.5};

// 测试不同强度等级的细骨料比例
console.log('=== 测试细骨料比例计算 ===');
const strengths = ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60'];

strengths.forEach(strength => {
  const result = calculateOptimalFineAggregateRatio([sand1, sand2], strength);
  console.log(`${strength}:`);
  console.log(`  机制砂比例: ${(result[0].ratio * 100).toFixed(1)}%`);
  console.log(`  河砂比例: ${(result[1].ratio * 100).toFixed(1)}%`);
  console.log(`  组合细度模数: ${result.combinedFinenessModulus.toFixed(3)}`);
  console.log(`  比例总和: ${((result[0].ratio + result[1].ratio) * 100).toFixed(1)}%`);
  console.log('');
});
