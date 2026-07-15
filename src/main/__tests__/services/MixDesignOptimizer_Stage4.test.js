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

describe('MixDesignOptimizer 阶段 4', () => {
  test('阶段 4 遍历所有粗骨料 → Top5', async () => {
    const opt = MixDesignOptimizer
    const stage4R = await opt._stage4ReassessCoarseAggregate({
      top5WithSand: [{
        totalCost: 200, waterRatio: 0.5, sandRatio: 35,
        cementitious: {
          flyAsh: 20, slag: 0, lithiumSlag: 0, compositePowder: 0,
          cementMat: { id: 10, name: 'P.O 42.5', price: 480, density: 3.15, compressiveStrength28d: 48 },
          flyAshMat: { id: 11, name: 'II级粉煤灰', price: 180, density: 2.2 },
          slagMat: null, lithiumSlagMat: null, compositePowderMat: null
        },
        blendedSand: { id: 'sand_blend', name: '混合砂', price: 140, density: 2.63, finenessModulus: 2.8, mbValue: 0.5 }
      }],
      materials: {
        stone: [
          { id: 1, name: '碎石 5-10mm', specification: '5-10mm', price: 100, density: 2.7 },
          { id: 2, name: '碎石 5-20mm', specification: '5-20mm', price: 120, density: 2.7 }
        ]
      },
      defaultSp: { id: 99, name: '聚羧酸减水剂', price: 5000, density: 1.05, waterReducingRate: 25, recommendedDosage: 1.5 },
      constraints: { strength: 'C30', slump: 120 },
      cancellationToken: { cancelled: false }
    })
    expect(stage4R.evaluatedCount).toBe(2)
    expect(stage4R.top5.length).toBeLessThanOrEqual(5)
    expect(stage4R.top5.length).toBeGreaterThan(0)
  })
})
