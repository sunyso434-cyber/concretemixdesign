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
    const opt = new MixDesignOptimizer()
    const blendedSand = { finenessModulus: 3.5, mbValue: 0.5 }  // 偏离 2.8 太远
    const accepted = opt._validateFinenessModulus(blendedSand.finenessModulus, 2.8, 0.5)
    expect(accepted).toBe(false)
  })

  test('混合 fm 偏离 ≤ 0.5 时接受', () => {
    const opt = new MixDesignOptimizer()
    expect(opt._validateFinenessModulus(2.9, 2.8, 0.5)).toBe(true)
  })

  test('阶段 3 输出 Top5', async () => {
    const opt = new MixDesignOptimizer()
    const result = await opt._stage3Refine({
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
    expect(result.length).toBeLessThanOrEqual(5)
    // Top5 按 totalCost 升序
    for (let i = 1; i < result.length; i++) {
      expect(result[i].totalCost).toBeGreaterThanOrEqual(result[i-1].totalCost)
    }
  })
})