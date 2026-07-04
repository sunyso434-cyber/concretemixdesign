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
    const opt = new MixDesignOptimizer()
    const result = await opt._stage4ReassessCoarseAggregate({
      top5WithSand: [{
        totalCost: 200, waterRatio: 0.5, sandRatio: 35,
        cementitious: {
          flyAsh: 20, slag: 0, lithiumSlag: 0, compositePowder: 0,
          flyAshMat: { id: 1 }, slagMat: null, lithiumSlagMat: null, compositePowderMat: null
        },
        blendedSand: { id: 'sand_blend' }
      }],
      materials: {
        stone: [
          { id: 1, specification: '5-10mm', price: 100 },
          { id: 2, specification: '5-20mm', price: 120 }
        ]
      },
      defaultSp: { id: 99, price: 5000 },
      constraints: { strength: 'C30', slump: 120 },
      cancellationToken: { cancelled: false }
    })
    expect(result.length).toBeLessThanOrEqual(5)
    expect(result.length).toBeGreaterThan(0)
  })
})