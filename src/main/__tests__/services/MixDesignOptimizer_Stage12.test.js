// SystemService mock — getStrengthStdDev/getRegressionCoefficients 间接经由它
const SystemService = require('../../../main/services/SystemService')
SystemService.getParamByName = async (name) => {
  const map = {
    'strengthStdDev_C30': { value: '5.0' },
    'regressionAlphaA': { value: '0.53' },
    'regressionAlphaB': { value: '0.20' }
  }
  return map[name] || null
}

const MixDesignOptimizer = require('../../../main/services/MixDesignOptimizer')

describe('MixDesignOptimizer 阶段 1+2', () => {
  test('阶段 1 预选粗骨料', async () => {
    const opt = MixDesignOptimizer
    const stone = opt._preselectStone([
      { id: 1, specification: '5-10mm', price: 100 },
      { id: 2, specification: '5-20mm', price: 120 }
    ])
    expect(stone.id).toBe(2)
  })

  test('阶段 2 返回 Top5 胶凝组合', async () => {
    const opt = MixDesignOptimizer
    const top5 = await opt._stage2Filter({
      materials: {
        cement: [{ id: 1, price: 480, compressiveStrength28d: 48 }],
        flyAsh: [{ id: 2, price: 180, waterDemandRatio: 92 }],
        slag: [],
        lithiumSlag: [],
        compositePowder: []
      },
      waterRatio: 0.5,
      baseWaterAmount: 150,
      defaultSpDosage: 1.5,
      defaultSp: { price: 5000 },
      flyAshRange: [0, 10, 20],
      slagRange: [0],
      lithiumSlagRange: [0],
      compositePowderRange: [0],
      maxAdmixtureRatio: 50,
      constraints: { strength: 'C30', slump: 120 },
      cancellationToken: { cancelled: false }
    })
    expect(top5.length).toBeLessThanOrEqual(5)
    expect(top5.length).toBeGreaterThan(0)
    // Top5 应该按水泥成本升序
    for (let i = 1; i < top5.length; i++) {
      expect(top5[i].cementitiousCost).toBeGreaterThanOrEqual(top5[i-1].cementitiousCost)
    }
  })

  test('所有掺合料总量超 maxAdmixtureRatio 时跳过', async () => {
    const opt = MixDesignOptimizer
    const top5 = await opt._stage2Filter({
      materials: {
        cement: [{ id: 1, price: 480, compressiveStrength28d: 48 }],
        flyAsh: [{ id: 2, price: 180 }],
        slag: [{ id: 3, price: 220 }],
        lithiumSlag: [],
        compositePowder: []
      },
      waterRatio: 0.5,
      baseWaterAmount: 150,
      defaultSpDosage: 1.5,
      defaultSp: { price: 5000 },
      flyAshRange: [30, 40],
      slagRange: [30, 40],
      lithiumSlagRange: [0],
      compositePowderRange: [0],
      maxAdmixtureRatio: 50,
      constraints: { strength: 'C30', slump: 120 },
      cancellationToken: { cancelled: false }
    })
    // 所有组合都应被拒（总掺量 > 50%）
    expect(top5.length).toBe(0)
  })
})
