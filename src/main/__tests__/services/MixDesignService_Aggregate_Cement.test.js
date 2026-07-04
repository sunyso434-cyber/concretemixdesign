const MixDesignService_Aggregate = require('../../../main/services/MixDesignService/MixDesignService_Aggregate')

describe('computeCementitiousCost', () => {
  test('纯水泥方案成本', () => {
    const cost = MixDesignService_Aggregate.computeCementitiousCost({
      baseWaterAmount: 150,
      waterRatio: 0.5,
      flyAsh: 0, slag: 0, lithiumSlag: 0, compositePowder: 0,
      cementMat: { price: 480 },
      flyAshMat: null, slagMat: null, lithiumSlagMat: null, compositePowderMat: null,
      spDosage: 1.5, spMat: { price: 5000 }
    })
    // 胶凝量 = 150 / 0.5 = 300 kg
    // 水泥 = 300 kg × 480 / 1000 = 144 元
    // 减水剂 = 300 × 0.015 × 5000 / 1000 = 22.5 元
    // 总 = 166.5 元
    expect(cost).toBeCloseTo(166.5, 1)
  })

  test('掺 20% 粉煤灰方案', () => {
    const cost = MixDesignService_Aggregate.computeCementitiousCost({
      baseWaterAmount: 150,
      waterRatio: 0.5,
      flyAsh: 20, slag: 0, lithiumSlag: 0, compositePowder: 0,
      cementMat: { price: 480 },
      flyAshMat: { price: 180 },
      slagMat: null, lithiumSlagMat: null, compositePowderMat: null,
      spDosage: 1.5, spMat: { price: 5000 }
    })
    // 胶凝量 = 300 kg
    // 粉煤灰 = 300 × 0.2 = 60 kg × 180/1000 = 10.8 元
    // 水泥 = 240 × 480/1000 = 115.2 元
    // 减水剂 = 300 × 0.015 × 5000/1000 = 22.5 元
    // 总 = 148.5 元
    expect(cost).toBeCloseTo(148.5, 1)
  })
})