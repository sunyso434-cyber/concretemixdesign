const ConcreteFitness = require('../../services/ConcreteFitness')
const { calcSpPenalty } = ConcreteFitness

jest.mock('../../services/XGBoostPredictionService', () => ({
  predict: jest.fn()
}))
const XGBoostPredictionService = require('../../services/XGBoostPredictionService')

jest.mock('../../services/MixDesignService/MixDesignService_Database', () => ({
  calculateMixDesign: jest.fn()
}))
const MixDesignService_Database = require('../../services/MixDesignService/MixDesignService_Database')

function makeSnapshot() {
  return {
    byId: new Map([
      [1, { id: 1, name: 'P.O 42.5', type: '水泥', price: 480, density: 3.1 }],
      [3, { id: 3, name: '粉煤灰I级', type: '粉煤灰', price: 180, density: 2.2 }],
      [7, { id: 7, name: '机制砂', type: '细骨料', price: 80, density: 2.65 }],
      [9, { id: 9, name: '碎石5-25', type: '粗骨料', price: 90, density: 2.70 }],
      [10, { id: 10, name: '聚羧酸A', type: '减水剂', price: 3500, density: 1.05 }],
      [11, { id: 11, name: '自来水', type: '水', price: 5, density: 1.00 }],
    ]),
    byType: { /* not needed for tests */ },
    candidatePools: {
      cement: [{ id: 1, name: 'P.O 42.5', type: '水泥', price: 480, density: 3.1 }],
      flyAsh: [{ id: 3, name: '粉煤灰I级', type: '粉煤灰', price: 180, density: 2.2 }],
      slag: [],
      lithiumSlag: [],
      compositePowder: [],
      sand: [{ id: 7, name: '机制砂', type: '细骨料', price: 80, density: 2.65 }],
      stone: [{ id: 9, name: '碎石5-25', type: '粗骨料', price: 90, density: 2.70 }],
      sp: [{ id: 10, name: '聚羧酸A', type: '减水剂', price: 3500, density: 1.05 }],
      water: [{ id: 11, name: '自来水', type: '水', price: 5, density: 1.00 }]
    }
  }
}

describe('calcSpPenalty', () => {
  test('偏差大于0.5个百分点计算罚分', () => {
    // spPrice=3500元/吨, deviation=0.8pp, binderTotal=350kg
    // materialCost = 3500/1000 * (0.8 * 350/100) = 3.5 * 2.8 = 9.8
    // riskCost = 10 * 0.8 = 8.0
    // penalty = 9.8 + 8.0 = 17.8
    const result = calcSpPenalty(3500, 0.8, 350)
    expect(result.materialCost).toBeCloseTo(9.8, 1)
    expect(result.riskCost).toBeCloseTo(8.0, 1)
    expect(result.penalty).toBeCloseTo(17.8, 1)
  })

  test('偏差小于0.5个百分点无罚分', () => {
    const result = calcSpPenalty(3500, 0.3, 350)
    expect(result.penalty).toBe(0)
    expect(result.materialCost).toBe(0)
    expect(result.riskCost).toBe(0)
  })

  test('零价格时罚分仅含风险成本', () => {
    // spPrice=0, deviation=0.8pp, binderTotal=350kg
    // materialCost = 0/1000 * (0.8 * 350/100) = 0
    // riskCost = 10 * 0.8 = 8.0
    const result = calcSpPenalty(0, 0.8, 350)
    expect(result.materialCost).toBe(0)
    expect(result.riskCost).toBeCloseTo(8.0, 1)
    expect(result.penalty).toBeCloseTo(8.0, 1)
  })

  test('零胶凝材料时罚分仅含风险成本', () => {
    // spPrice=3500, deviation=0.8pp, binderTotal=0
    // materialCost = 3500/1000 * (0.8 * 0/100) = 0
    // riskCost = 10 * 0.8 = 8.0
    const result = calcSpPenalty(3500, 0.8, 0)
    expect(result.materialCost).toBe(0)
    expect(result.riskCost).toBeCloseTo(8.0, 1)
    expect(result.penalty).toBeCloseTo(8.0, 1)
  })

  test('偏差刚好0.5个百分点边界值无罚分', () => {
    const result = calcSpPenalty(3500, 0.5, 350)
    expect(result.penalty).toBe(0)
    expect(result.materialCost).toBe(0)
    expect(result.riskCost).toBe(0)
  })
})

describe('ConcreteFitness.evaluate', () => {
  beforeEach(() => {
    XGBoostPredictionService.predict.mockReset()
    MixDesignService_Database.calculateMixDesign.mockReset()
  })

  test('达标方案无强度罚分', async () => {
    const snapshot = makeSnapshot()
    const fitness = new ConcreteFitness(snapshot, 38, 200, {})
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: snapshot.candidatePools.sand[0],
      stone: snapshot.candidatePools.stone[0],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      flyAsh: snapshot.candidatePools.flyAsh[0],
      wb: 0.45,
      flyAshDosage: 15,
      sandRatio: 40,
      spDosage: 1.5
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        water: 165, cement: 280, flyAsh: 60, slag: 0,
        lithiumSlag: 0, compositePowder: 0,
        sand: 700, stone: 1000, superplasticizer: 5.95
      }
    })
    XGBoostPredictionService.predict.mockResolvedValue({
      predictions: {
        strength28d: { value: 40 },
        density: { value: 2400 },
        superplasticizer_dosage: { value: 1.2 }
      }
    })
    const result = await fitness.evaluate(genes)
    expect(result.strengthGap).toBe(-2)
    expect(result.fitness).toBe(result.realCost)
  })

  test('强度差 2MPa 软约束罚分', async () => {
    const snapshot = makeSnapshot()
    const fitness = new ConcreteFitness(snapshot, 38, 200, {})
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: snapshot.candidatePools.sand[0],
      stone: snapshot.candidatePools.stone[0],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      flyAsh: snapshot.candidatePools.flyAsh[0],
      wb: 0.50,
      flyAshDosage: 15,
      sandRatio: 40,
      spDosage: 1.5
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        water: 165, cement: 250, flyAsh: 50, slag: 0,
        lithiumSlag: 0, compositePowder: 0,
        sand: 750, stone: 950, superplasticizer: 5.0
      }
    })
    XGBoostPredictionService.predict.mockResolvedValue({
      predictions: {
        strength28d: { value: 36 },
        density: { value: 2400 },
        superplasticizer_dosage: { value: 1.2 }
      }
    })
    const result = await fitness.evaluate(genes)
    expect(result.strengthGap).toBe(2)
    expect(result.fitness).toBe(result.realCost + 2 * 2)
  })

  test('强度差 4MPa 硬淘汰', async () => {
    const snapshot = makeSnapshot()
    const fitness = new ConcreteFitness(snapshot, 38, 200, {})
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: snapshot.candidatePools.sand[0],
      stone: snapshot.candidatePools.stone[0],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      flyAsh: snapshot.candidatePools.flyAsh[0],
      wb: 0.55,
      flyAshDosage: 15,
      sandRatio: 40,
      spDosage: 1.5
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        water: 165, cement: 220, flyAsh: 40, slag: 0,
        lithiumSlag: 0, compositePowder: 0,
        sand: 800, stone: 900, superplasticizer: 4.0
      }
    })
    XGBoostPredictionService.predict.mockResolvedValue({
      predictions: {
        strength28d: { value: 34 },
        density: { value: 2400 },
        superplasticizer_dosage: { value: 1.2 }
      }
    })
    const result = await fitness.evaluate(genes)
    expect(result.fitness).toBe(Number.MAX_VALUE)
  })

  test('减水剂偏差罚分', async () => {
    const snapshot = makeSnapshot()
    const fitness = new ConcreteFitness(snapshot, 38, 200, {})
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: snapshot.candidatePools.sand[0],
      stone: snapshot.candidatePools.stone[0],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      flyAsh: snapshot.candidatePools.flyAsh[0],
      wb: 0.45,
      flyAshDosage: 15,
      sandRatio: 40,
      spDosage: 2.0
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        water: 165, cement: 280, flyAsh: 60, slag: 0,
        lithiumSlag: 0, compositePowder: 0,
        sand: 700, stone: 1000, superplasticizer: 5.95
      }
    })
    XGBoostPredictionService.predict.mockResolvedValue({
      predictions: {
        strength28d: { value: 40 },
        density: { value: 2400 },
        superplasticizer_dosage: { value: 2.8 }
      }
    })
    const result = await fitness.evaluate(genes)
    // spDeviation = |2.8 - 2.0| = 0.8
    expect(result.spDeviation).toBeCloseTo(0.8, 2)
    // materialCost = 3500/1000 * (0.8 * 340/100) = 3.5 * 2.72 = 9.52
    // riskCost = 10 * 0.8 = 8
    // total ≈ 17.52
    expect(result.spDeviationPenalty).toBeCloseTo(17.52, 1)
    expect(result.spMaterialCost).toBeCloseTo(9.52, 1)
    expect(result.spRiskCost).toBeCloseTo(8, 1)
  })

  test('掺合料总掺超限罚分', async () => {
    const snapshot = makeSnapshot()
    const fitness = new ConcreteFitness(snapshot, 38, 200, {})
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: snapshot.candidatePools.sand[0],
      stone: snapshot.candidatePools.stone[0],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      flyAsh: snapshot.candidatePools.flyAsh[0],
      wb: 0.45,
      flyAshDosage: 35,
      slagDosage: 20,
      sandRatio: 40,
      spDosage: 1.5
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        water: 165, cement: 180, flyAsh: 100, slag: 60, lithiumSlag: 0, compositePowder: 0,
        sand: 700, stone: 1000, superplasticizer: 5.95
      }
    })
    XGBoostPredictionService.predict.mockResolvedValue({
      predictions: {
        strength28d: { value: 40 },
        density: { value: 2400 },
        superplasticizer_dosage: { value: 1.2 }
      }
    })
    const result = await fitness.evaluate(genes)
    // additiveTotal = 35 + 20 = 55, over 50 by 5
    // additivePenalty = 5 * 5 = 25
    expect(result.additivePenalty).toBe(25)
  })

  test('返回结构包含所有必要字段', async () => {
    const snapshot = makeSnapshot()
    const fitness = new ConcreteFitness(snapshot, 38, 200, {})
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: snapshot.candidatePools.sand[0],
      stone: snapshot.candidatePools.stone[0],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      flyAsh: snapshot.candidatePools.flyAsh[0],
      wb: 0.45,
      flyAshDosage: 15,
      sandRatio: 40,
      spDosage: 1.5
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        water: 165, cement: 280, flyAsh: 60, slag: 0,
        lithiumSlag: 0, compositePowder: 0,
        sand: 700, stone: 1000, superplasticizer: 5.95
      }
    })
    XGBoostPredictionService.predict.mockResolvedValue({
      predictions: {
        strength28d: { value: 40 },
        density: { value: 2410 },
        superplasticizer_dosage: { value: 1.2 }
      }
    })
    const result = await fitness.evaluate(genes)
    expect(result).toHaveProperty('fitness')
    expect(result).toHaveProperty('realCost')
    expect(result).toHaveProperty('strengthGap')
    expect(result).toHaveProperty('spDeviation')
    expect(result).toHaveProperty('spDeviationPenalty')
    expect(result).toHaveProperty('spMaterialCost')
    expect(result).toHaveProperty('spRiskCost')
    expect(result).toHaveProperty('additivePenalty')
    expect(result).toHaveProperty('materials')
    expect(result).toHaveProperty('predictions')
    expect(result.materials).toBeInstanceOf(Array)
    expect(result.materials.length).toBe(8)
    // Check materials structure
    const types = result.materials.map(m => m.type)
    expect(types).toContain('cement')
    expect(types).toContain('flyAsh')
    expect(types).toContain('water')
    expect(types).toContain('sand1')
    expect(types).toContain('stone1')
    expect(types).toContain('sp')
    // Each material should have materialId, mass, density
    for (const mat of result.materials) {
      expect(mat).toHaveProperty('materialId')
      expect(mat).toHaveProperty('mass')
      expect(mat).toHaveProperty('density')
    }
  })
})
