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

describe('MixDesignOptimizer 阶段 5 + 主流程', () => {
  test('阶段 5 遍历所有减水剂品种', async () => {
    const opt = new MixDesignOptimizer()
    const result = await opt._stage5SuperplasticizerSearch({
      top5WithStone: [{
        totalCost: 200, waterRatio: 0.5, sandRatio: 35,
        cementitious: { flyAsh: 20, slag: 0, lithiumSlag: 0, compositePowder: 0,
          flyAshMat: { id: 1 }, slagMat: null, lithiumSlagMat: null, compositePowderMat: null },
        blendedSand: { id: 'sand_blend' },
        stoneMat: { id: 9, specification: '5-20mm', price: 120 }
      }],
      materials: {
        superplasticizer: [
          { id: 1, name: '减水剂A', price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 },
          { id: 2, name: '减水剂B', price: 6000, waterReducingRate: 30, recommendedDosage: 1.2 }
        ]
      },
      constraints: { strength: 'C30', slump: 120 },
      cancellationToken: { cancelled: false }
    })
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  test('主流程 optimizeMixDesign 返回 { bestSolution, alternatives, totalEvaluated }', async () => {
    const opt = new MixDesignOptimizer()
    const result = await opt.optimizeMixDesign({
      constraints: {
        strength: 'C30', slump: 120,
        materials: {
          cement: [{ id: 1, price: 480, compressiveStrength28d: 48 }],
          flyAsh: [{ id: 2, price: 180 }],
          slag: [],
          lithiumSlag: [],
          compositePowder: [],
          sand: [{ id: 7, finenessModulus: 2.8, mbValue: 0.5, price: 150 }],
          stone: [{ id: 9, specification: '5-20mm', price: 120 }],
          superplasticizer: [{ id: 11, price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 }]
        }
      },
      userLimits: { flyAshRange: [0, 30], slagRange: [0, 20], gridStep: 5 },
      maxAdmixtureRatio: 50
    }, { cancelled: false }, (progress) => {
      // 验证进度回调
      expect(progress).toHaveProperty('phase')
    })

    expect(result.bestSolution).toBeDefined()
    expect(result.alternatives).toBeDefined()
    expect(result.totalEvaluated).toBeGreaterThan(0)
  })
})
