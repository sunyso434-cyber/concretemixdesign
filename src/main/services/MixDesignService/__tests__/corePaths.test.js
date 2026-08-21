// MixDesignService 核心路径单元测试（优化项 6 补充）
// 覆盖 Strength（标准差/配制强度/目标细度模数）、WaterRatio（回归系数/水胶比）、
// Aggregate（最大粒径/粗骨料预选/目标细度模数分级/绝对体积法/质量法/用水量/容重）
// SystemService 与 DB 依赖统一 mock，只测纯计算路径（touches 真实参数查询用 mock 返回值）
jest.mock('../../SystemService', () => ({
  getParamByName: jest.fn(),
}))
const SystemService = require('../../SystemService')
const MixDesignService = require('../index')

describe('Strength 模块', () => {
  test('calculateTargetStrength：f_cu,0 = f_cu,k + 1.645×σ', () => {
    expect(MixDesignService.calculateTargetStrength('C30', 5)).toBe(38.225)
    expect(MixDesignService.calculateTargetStrength('C50', 6)).toBeCloseTo(59.87, 10)
  })

  test('computeTargetFinenessModulus：默认 C30 基准 2.7 + 等级调整', () => {
    expect(MixDesignService.computeTargetFinenessModulus('C30')).toBe(2.7)
    expect(MixDesignService.computeTargetFinenessModulus('C45')).toBe(3.0)   // 2.7 + 15×0.02
    expect(MixDesignService.computeTargetFinenessModulus('C20')).toBe(2.5)   // 2.7 - 10×0.02
  })

  test('computeTargetFinenessModulus：用户显式指定 targetFinenessModulusBase 时直接采用', () => {
    expect(MixDesignService.computeTargetFinenessModulus('C60', { targetFinenessModulusBase: 3.3 })).toBe(3.3)
  })

  test('computeTargetFinenessModulus：非法强度兜底 2.7', () => {
    expect(MixDesignService.computeTargetFinenessModulus(undefined)).toBe(2.7)
  })

  test('getStrengthStdDev：tempSettings 显式值优先', async () => {
    const sd = await MixDesignService.getStrengthStdDev('C30', { strengthStdDev: '4.5' })
    expect(sd).toBe(4.5)
    expect(SystemService.getParamByName).not.toHaveBeenCalled()
  })

  test('getStrengthStdDev：按强度等级查询系统参数', async () => {
    SystemService.getParamByName.mockResolvedValueOnce({ value: '4.5' })
    const sd = await MixDesignService.getStrengthStdDev('C30', null)
    expect(SystemService.getParamByName).toHaveBeenCalledWith('strengthStdDev_C45')
    expect(sd).toBe(4.5)
  })

  test('getStrengthStdDev：无参数时按等级默认 4.0/5.0/6.0', async () => {
    SystemService.getParamByName.mockResolvedValue(null)
    expect(await MixDesignService.getStrengthStdDev('C20')).toBe(4.0)
    expect(await MixDesignService.getStrengthStdDev('C30')).toBe(5.0)
    expect(await MixDesignService.getStrengthStdDev('C60')).toBe(6.0)
  })
})

describe('WaterRatio 模块', () => {
  test('getRegressionCoefficients：tempSettings 优先', async () => {
    const rc = await MixDesignService.getRegressionCoefficients({ regressionAlphaA: '0.46', regressionAlphaB: '0.08' })
    expect(rc).toEqual({ alphaA: 0.46, alphaB: 0.08 })
  })

  test('getRegressionCoefficients：无 tempSettings 走系统参数，缺省用默认值', async () => {
    SystemService.getParamByName
      .mockResolvedValueOnce({ value: '0.50' })
      .mockResolvedValueOnce({ value: '0.10' })
    const rc = await MixDesignService.getRegressionCoefficients(null)
    expect(rc).toEqual({ alphaA: 0.50, alphaB: 0.10 })
    SystemService.getParamByName.mockResolvedValue(null)
    const rcDefault = await MixDesignService.getRegressionCoefficients(null)
    expect(rcDefault).toEqual({ alphaA: 0.53, alphaB: 0.20 })
  })

  test('calculateWaterRatio：W/B = αa×fb / (fcu,0 + αa×αb×fb)', () => {
    // C30 配制强度 38.225、水泥 42.5、碎石默认系数 αa=0.53 αb=0.20
    const ratio = MixDesignService.calculateWaterRatio(38.225, 42.5, 0.53, 0.20)
    const expected = (0.53 * 42.5) / (38.225 + 0.53 * 0.20 * 42.5)
    expect(ratio).toBeCloseTo(expected, 10)
    expect(ratio).toBeGreaterThan(0.5)
    expect(ratio).toBeLessThan(0.6)
  })

  test('calculateWaterRatio：W/B 随目标强度增大而减小（单调性）', () => {
    const r30 = MixDesignService.calculateWaterRatio(38.225, 42.5, 0.53, 0.20)
    const r40 = MixDesignService.calculateWaterRatio(48.225, 42.5, 0.53, 0.20)
    expect(r40).toBeLessThan(r30)
  })
})

describe('Aggregate 模块', () => {
  test('extractMaxAggregateSize：区间/单值/缺失解析', () => {
    expect(MixDesignService.extractMaxAggregateSize('5-20mm')).toBe(20)
    expect(MixDesignService.extractMaxAggregateSize('10-25mm')).toBe(25)
    expect(MixDesignService.extractMaxAggregateSize('20mm')).toBe(20)
    expect(MixDesignService.extractMaxAggregateSize(null)).toBe(20)
    expect(MixDesignService.extractMaxAggregateSize('碎石')).toBe(20)
  })

  test('preselectCoarseAggregate：粒径最大优先，同粒径选最便宜', () => {
    const candidates = [
      { id: 1, specification: '5-10mm', price: 80 },
      { id: 2, specification: '5-20mm', price: 90 },
      { id: 3, specification: '5-20mm', price: 85 },
    ]
    const picked = MixDesignService.preselectCoarseAggregate(candidates)
    expect(picked.id).toBe(3) // 同 maxSize=20 中价格最低
  })

  test('preselectCoarseAggregate：空候选抛错', () => {
    expect(() => MixDesignService.preselectCoarseAggregate([])).toThrow('粗骨料候选为空')
  })

  test('targetFinenessModulusByStrength：按强度等级分档', () => {
    expect(MixDesignService.targetFinenessModulusByStrength('C25')).toBe(2.6)
    expect(MixDesignService.targetFinenessModulusByStrength('C30')).toBe(2.8)
    expect(MixDesignService.targetFinenessModulusByStrength('C45')).toBe(3.0)
    expect(MixDesignService.targetFinenessModulusByStrength('C55')).toBe(3.2)
    expect(MixDesignService.targetFinenessModulusByStrength('C70')).toBe(3.4)
  })

  test('calculateByAbsoluteVolume：材料体积 = 用量/密度，含空气体积', () => {
    const materialAmounts = { cement: 300, water: 160 }
    const materials = { cement: { density: 3.1 }, water: { density: 1.0 } }
    const result = MixDesignService.calculateByAbsoluteVolume(materialAmounts, materials, 1.0)
    expect(result.volumes.cement).toBeCloseTo(96.77419, 4)  // 300/3.1
    expect(result.volumes.water).toBe(160)
    expect(result.airVolume).toBe(0.01)
    // 无骨料时缩放系数兜底 1
    expect(result.scaleFactor).toBe(1)
  })

  test('calculateByMassMethod：按目标容重等比缩放', () => {
    const materialAmounts = { cement: 300, water: 160, sand: 700, stone: 1200 } // 合计 2360
    const result = MixDesignService.calculateByMassMethod(materialAmounts, 2400)
    expect(result.scaleFactor).toBeCloseTo(2400 / 2360, 6)
    expect(result.finalDensity).toBe(2400)
    expect(result.materialAmounts.cement).toBeCloseTo(300 * (2400 / 2360), 6)
  })

  test('calculateWaterAmount：按坍落度分档', () => {
    expect(MixDesignService.calculateWaterAmount(30)).toBe(160)
    expect(MixDesignService.calculateWaterAmount(70)).toBe(170)
    expect(MixDesignService.calculateWaterAmount(100)).toBe(180)
    expect(MixDesignService.calculateWaterAmount(140)).toBe(190)
    expect(MixDesignService.calculateWaterAmount(200)).toBe(200)
  })

  test('calculateDensity：剔除细骨料细分键，只累加主用量（子模块方法，未在 index 暴露）', () => {
    const Aggregate = require('../MixDesignService_Aggregate')
    const density = Aggregate.calculateDensity({
      cement: 300, water: 160, sand: 700, stone: 1200, sand_5: 200, stone_9: 300,
    })
    expect(density).toBe(2360)
  })

  test('calculateDensity：非法输入返回 0（子模块方法）', () => {
    const Aggregate = require('../MixDesignService_Aggregate')
    expect(Aggregate.calculateDensity(null)).toBe(0)
    expect(Aggregate.calculateDensity('x')).toBe(0)
  })
})