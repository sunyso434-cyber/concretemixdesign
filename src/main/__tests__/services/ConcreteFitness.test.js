const ConcreteFitness = require('../../services/ConcreteFitness')

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
      sandRatio: 35,
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
      sandRatio: 36,
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

  test('减水剂成本用预测掺量计算', async () => {
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
    // binderTotal = 280 + 60 = 340
    // spPredictedAmount = 340 * 2.8 / 100 = 9.52
    expect(result.spPredictedAmount).toBeCloseTo(9.52, 2)
    // 减水剂成本 = 9.52 * 3500 / 1000 = 33.32
    // 验证 predictions 同时包含基因值和预测值
    expect(result.predictions.spDosagePredicted).toBe(2.8)
    expect(result.predictions.spDosageGene).toBe(2.0)
    // 验证已删除减水剂偏差罚分相关字段
    expect(result).not.toHaveProperty('spDeviation')
    expect(result).not.toHaveProperty('spDeviationPenalty')
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
    // 梯度递增：excess=5, tier=floor(5-1e-9)=4, 10×2^4=160
    expect(result.additivePenalty).toBe(160)
  })

  test('sand2Proportion/stone2Proportion 从百分比转换为小数', async () => {
    const snapshot = makeSnapshot()
    // 给砂和石各添加第二种材料
    snapshot.candidatePools.sand.push({ id: 8, name: '河砂', type: '细骨料', price: 90, density: 2.60 })
    snapshot.candidatePools.stone.push({ id: 12, name: '碎石10-20', type: '粗骨料', price: 95, density: 2.75 })

    const fitness = new ConcreteFitness(snapshot, 38, 200, { additiveTotalMax: 50 })
    const genes = {
      cement: snapshot.candidatePools.cement[0],
      sand: [snapshot.candidatePools.sand[0], snapshot.candidatePools.sand[1]],
      stone: [snapshot.candidatePools.stone[0], snapshot.candidatePools.stone[1]],
      sp: snapshot.candidatePools.sp[0],
      water: snapshot.candidatePools.water[0],
      wb: 0.45,
      sandRatio: 40,
      spDosage: 1.5,
      sand2Proportion: 30, // 30% → 0.3
      stone2Proportion: 40 // 40% → 0.4
    }
    MixDesignService_Database.calculateMixDesign.mockResolvedValue({
      materials: {
        // cement 用量给 320 让 binderTotal ≥ 300，避免触发胶凝材料下限淘汰
        water: 165, cement: 320, flyAsh: 0, slag: 0,
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
    // 验证质量拆分比例正确
    const matMap = {}
    for (const m of result.materials) {
      matMap[m.type] = m
    }
    // sandTotal = 700, sand2Proportion = 30% → sand1 = 490, sand2 = 210
    expect(matMap.sand1.mass).toBe(490)
    expect(matMap.sand2.mass).toBe(210)
    // stoneTotal = 1000, stone2Proportion = 40% → stone1 = 600, stone2 = 400
    expect(matMap.stone1.mass).toBe(600)
    expect(matMap.stone2.mass).toBe(400)
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
    expect(result).toHaveProperty('additivePenalty')
    expect(result).toHaveProperty('materials')
    expect(result).toHaveProperty('predictions')
    expect(result).toHaveProperty('spPredictedAmount')
    expect(result.predictions).toHaveProperty('spDosagePredicted')
    expect(result.predictions).toHaveProperty('spDosageGene')
    expect(result.materials).toBeInstanceOf(Array)
    expect(result.materials.length).toBe(11)
    // Check materials structure
    const types = result.materials.map(m => m.type)
    expect(types).toContain('cement')
    expect(types).toContain('flyAsh')
    expect(types).toContain('slag')
    expect(types).toContain('lithiumSlag')
    expect(types).toContain('compositePowder')
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
