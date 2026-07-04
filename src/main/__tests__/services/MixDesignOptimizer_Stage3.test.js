// SystemService mock — getStrengthStdDev/getRegressionCoefficients 间接经由它
const SystemService = require('../../../main/services/SystemService')
SystemService.getParamByName = async (name) => {
  const map = {
    'strengthStdDev_C30': { value: '5.0' },
    'regressionAlphaA': { value: '0.53' },
    'regressionAlphaB': { value: '0.20' },
    'waterReducingRatePer01Dosage': { value: '2.0' }
  }
  return map[name] || null
}

const MixDesignOptimizer = require('../../../main/services/MixDesignOptimizer')

describe('MixDesignOptimizer 阶段 3', () => {
  test('混合 fm 偏离目标 > 0.5 时拒绝', async () => {
    const opt = MixDesignOptimizer
    const blendedSand = { finenessModulus: 3.5, mbValue: 0.5 }  // 偏离 2.8 太远
    const accepted = opt._validateFinenessModulus(blendedSand.finenessModulus, 2.8, 0.5)
    expect(accepted).toBe(false)
  })

  test('混合 fm 偏离 ≤ 0.5 时接受', () => {
    const opt = MixDesignOptimizer
    expect(opt._validateFinenessModulus(2.9, 2.8, 0.5)).toBe(true)
  })

  test('阶段 3 输出 Top5', async () => {
    const opt = MixDesignOptimizer
    const stage3R = await opt._stage3Refine({
      top5Cementitious: [{
        cementMat: { id: 1, price: 480, compressiveStrength28d: 48 },
        flyAshMat: { id: 2, price: 180 },
        slagMat: null, lithiumSlagMat: null, compositePowderMat: null,
        flyAsh: 20, slag: 0, lithiumSlag: 0, compositePowder: 0,
        waterRatio: 0.5, cementitiousCost: 148.5
      }],
      materials: {
        sand: [{ id: 1, finenessModulus: 2.6, mbValue: 0.5, price: 150 }, { id: 2, finenessModulus: 3.2, mbValue: 0.7, price: 130 }]
      },
      fineAggregateRatios: [[0.5, 0.5], [0.6, 0.4]],
      T_FM: 2.8,
      defaultSpDosage: 1.5,
      defaultSp: { id: 99, price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 },
      stoneInitial: { id: 9, specification: '5-20mm', price: 120 },
      constraints: { strength: 'C30', slump: 120 },
      cancellationToken: { cancelled: false }
    })
    expect(stage3R.top5.length).toBeLessThanOrEqual(5)
    // Top5 按 totalCost 升序
    for (let i = 1; i < stage3R.top5.length; i++) {
      expect(stage3R.top5[i].totalCost).toBeGreaterThanOrEqual(stage3R.top5[i-1].totalCost)
    }
  })

  // Critical #1 回归测试：_validateConstraints 必须尊重 userLimits.waterRatioRange
  test('_validateConstraints 接受 userLimits.waterRatioRange 并拒绝越界水胶比', () => {
    const opt = MixDesignOptimizer
    const baseResult = {
      targetStrength: 40,
      waterRatio: 0.5,
      materials: { cement: 300, flyAsh: 80, slag: 0, lithiumSlag: 0, compositePowder: 0, water: 175 }
    }
    // 1. 在范围内 → 通过
    expect(opt._validateConstraints(baseResult, { strength: 'C30' }, { waterRatioRange: [0.4, 0.6] })).toBe(true)
    // 2. 低于下限 → 拒绝
    expect(opt._validateConstraints({ ...baseResult, waterRatio: 0.3 }, { strength: 'C30' }, { waterRatioRange: [0.4, 0.6] })).toBe(false)
    // 3. 高于上限 → 拒绝
    expect(opt._validateConstraints({ ...baseResult, waterRatio: 0.7 }, { strength: 'C30' }, { waterRatioRange: [0.4, 0.6] })).toBe(false)
    // 4. 不传 userLimits → 默认 {} → 不做水胶比范围检查
    expect(opt._validateConstraints({ ...baseResult, waterRatio: 0.3 }, { strength: 'C30' })).toBe(true)
  })
})