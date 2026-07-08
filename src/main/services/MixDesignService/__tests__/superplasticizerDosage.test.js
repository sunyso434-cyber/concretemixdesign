/**
 * 减水剂掺量新规则测试（v10.7.7 老板新规则）
 *
 * 新规则要点：
 * 1. C30 基准掺量 = 减水剂材料 recommendedDosage（兜底 1.8%）
 * 2. 等级掺量：用户单点指定 > 从 C30 基准派生（±0.1%/5强度）
 * 3. 减水率 = 材料 waterReducingRate + (strengthDosage - 材料推荐掺量) / 0.1 × 材料 waterReducingRatePer01Dosage
 * 4. 砂石 MB/细度模数 微调产生的掺量变化不影响减水率
 * 5. 没选减水剂材料 → 掺量=0, 减水率=0
 */

// mock SystemService：getParamByName 全部返回 null（无用户覆盖）
jest.mock('../../SystemService', () => ({
  getParamByName: jest.fn().mockResolvedValue(null)
}))

const MixDesignService_WaterRatio = require('../MixDesignService_WaterRatio')
const MixDesignService_Aggregate = require('../MixDesignService_Aggregate')

// 减水剂材料：标准型（推荐 1.5%）
const spStd = { name: '聚羧酸标准型', recommendedDosage: 1.5, waterReducingRate: 28, waterReducingRatePer01Dosage: 2.0 }
// 减水剂材料：缓凝型（推荐 1.8%）
const spRet = { name: '聚羧酸缓凝型', recommendedDosage: 1.8, waterReducingRate: 28, waterReducingRatePer01Dosage: 2.0 }
// 减水剂材料：推荐掺量为 null
const spNull = { name: '奇怪减水剂', recommendedDosage: null, waterReducingRate: 25, waterReducingRatePer01Dosage: 2.0 }
// 减水剂材料：自定义水率
const spCustom = { name: '高效减水剂', recommendedDosage: 1.2, waterReducingRate: 30, waterReducingRatePer01Dosage: 2.5 }

describe('getC30Baseline C30 基准掺量', () => {
  test('场景 1：标准型材料（推荐 1.5%），无用户覆盖 → 1.5', async () => {
    expect(await MixDesignService_WaterRatio.getC30Baseline(spStd, null)).toBe(1.5)
  })

  test('场景 2：缓凝型材料（推荐 1.8%），无用户覆盖 → 1.8', async () => {
    expect(await MixDesignService_WaterRatio.getC30Baseline(spRet, null)).toBe(1.8)
  })

  test('场景 3：推荐掺量为 null → 1.8 兜底', async () => {
    expect(await MixDesignService_WaterRatio.getC30Baseline(spNull, null)).toBe(1.8)
  })

  test('场景 4：用户 tempSettings 覆盖 C30 基准=1.8 → 1.8（无视材料推荐）', async () => {
    expect(await MixDesignService_WaterRatio.getC30Baseline(spStd, { superplasticizerDosageBase_C30: 1.8 })).toBe(1.8)
  })

  test('场景 5：无材料 → 1.8 兜底', async () => {
    expect(await MixDesignService_WaterRatio.getC30Baseline(null, null)).toBe(1.8)
  })
})

describe('getSuperplasticizerDosageByStrength 等级掺量', () => {
  test('场景 1：标准型(1.5%)，C20~C50 全部派生', async () => {
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C20', spStd, null)).toBe(1.3) // 1.5 - 0.2
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C25', spStd, null)).toBe(1.4) // 1.5 - 0.1
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', spStd, null)).toBe(1.5)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C35', spStd, null)).toBe(1.6) // 1.5 + 0.1
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C40', spStd, null)).toBe(1.7) // 1.5 + 0.2
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C50', spStd, null)).toBe(1.9) // 1.5 + 0.4
  })

  test('场景 2：缓凝型(1.8%)，C20~C50 全部派生', async () => {
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C20', spRet, null)).toBe(1.6)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', spRet, null)).toBe(1.8)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C50', spRet, null)).toBe(2.2)
  })

  test('场景 3：用户调 C30 基准=1.8 → 全部按 1.8 派生（无视材料 1.5）', async () => {
    const ts = { superplasticizerDosageBase_C30: 1.8 }
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C20', spStd, ts)).toBe(1.6)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', spStd, ts)).toBe(1.8)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C40', spStd, ts)).toBe(2.0)
  })

  test('场景 4：用户调 C30 基准=2.0 → 全部按 2.0 派生', async () => {
    const ts = { superplasticizerDosageBase_C30: 2.0 }
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C40', spStd, ts)).toBe(2.2)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C50', spStd, ts)).toBe(2.4)
  })

  test('场景 5：用户单点指定 C40=2.5 → 用指定值（C30 基准不变）', async () => {
    const ts = { superplasticizerDosage_C40: 2.5 }
    // C40 用 2.5
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C40', spStd, ts)).toBe(2.5)
    // 其他等级仍按材料推荐 1.5 派生
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', spStd, ts)).toBe(1.5)
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C35', spStd, ts)).toBe(1.6)
  })

  test('场景 6：没选材料 → 0', async () => {
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', null, null)).toBe(0)
  })

  test('场景 7：C60 外推', async () => {
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C60', spStd, null)).toBe(2.1) // 1.5 + 0.6
  })

  test('场景 8：缓凝型 + 用户单点 C30 使用=1.5 → C30=1.5, C35=1.9（按 1.8 基准派生）', async () => {
    const ts = { superplasticizerDosage_C30: 1.5 }
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', spRet, ts)).toBe(1.5) // 用户指定
    expect(await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C35', spRet, ts)).toBeCloseTo(1.9, 4) // 仍按 1.8 基准派生
  })
})

describe('calculateWaterReducingRate 减水率公式', () => {
  test('公式 1：标准型(1.5%)，默认 C30=1.5 → 减水率 28%', async () => {
    // 减水率 = 28 + (1.5-1.5)/0.1 × 2 = 28
    expect(await MixDesignService_Aggregate.calculateWaterReducingRate(28, 1.5, 1.5, spStd, null)).toBe(28)
  })

  test('公式 2：标准型，调整 C30 基准=1.8 → C30 strengthDosage=1.8 → 减水率=28+6=34%', async () => {
    // 减水率 = 28 + (1.8-1.5)/0.1 × 2 = 28 + 6 = 34
    expect(await MixDesignService_Aggregate.calculateWaterReducingRate(28, 1.5, 1.8, spStd, null)).toBe(34)
  })

  test('公式 3：标准型，调整 C30 使用=1.8 → C30 strengthDosage=1.8 → 减水率=34%', async () => {
    // 同公式 2
    expect(await MixDesignService_Aggregate.calculateWaterReducingRate(28, 1.5, 1.8, spStd, null)).toBe(34)
  })

  test('公式 4：标准型，调 C40=2.5 → C40 strengthDosage=2.5 → 减水率=28+20=48%', async () => {
    expect(await MixDesignService_Aggregate.calculateWaterReducingRate(28, 1.5, 2.5, spStd, null)).toBe(48)
  })

  test('公式 5：高效减水剂(1.2%, 30%, 2.5) → C30 默认 → 减水率 30%', async () => {
    // 减水率 = 30 + (1.2-1.2)/0.1 × 2.5 = 30
    expect(await MixDesignService_Aggregate.calculateWaterReducingRate(30, 1.2, 1.2, spCustom, null)).toBe(30)
  })

  test('公式 6：高效减水剂，C30 基准=1.5（用户覆盖） → 减水率=30+(1.5-1.2)/0.1×2.5=30+7.5=37.5%', async () => {
    // 验证公式用的是 strengthDosage - 材料推荐掺量，不是 strengthDosage - 用户覆盖基准
    expect(await MixDesignService_Aggregate.calculateWaterReducingRate(30, 1.2, 1.5, spCustom, null)).toBeCloseTo(37.5, 4)
  })
})

describe('calculateSuperplasticizerDosage 综合（含砂石微调）', () => {
  test('场景 A：标准型(1.5%)，C30 计算 → strengthDosage=1.5, finalDosage=1.5+砂石微调', async () => {
    const sand = { mbValue: 0.5, finenessModulus: 2.7 } // 理想砂子，无微调
    const r = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand, spStd, null)
    expect(r.hasSuperplasticizer).toBe(true)
    expect(r.strengthDosage).toBe(1.5)
    expect(r.baseDosage).toBe(1.5)
    expect(r.mbAdjustment).toBeCloseTo(0, 4)
    expect(r.fmAdjustment).toBeCloseTo(0, 4)
    expect(r.finalDosage).toBeCloseTo(1.5, 4)
  })

  test('场景 B：标准型(1.5%)，C30 基准覆盖=1.8 + 砂 MB=1.0（+0.5 调整） → strengthDosage=1.8, finalDosage=2.3', async () => {
    const sand = { mbValue: 1.0, finenessModulus: 2.7 } // MB+0.5 调整
    const ts = { superplasticizerDosageBase_C30: 1.8 }
    const r = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand, spStd, ts)
    expect(r.strengthDosage).toBe(1.8) // 减水率用这个
    expect(r.mbAdjustment).toBeCloseTo(0.5, 4) // MB+0.5 调整
    expect(r.finalDosage).toBeCloseTo(2.3, 4) // 实际掺量含微调
  })

  test('场景 C：减水率按 strengthDosage 算（不受砂石微调影响）', async () => {
    // 场景 B 情况下：减水率 = 28 + (1.8-1.5)/0.1 × 2 = 34%（不是 28+(2.3-1.5)/0.1×2=44%）
    const sand = { mbValue: 1.0, finenessModulus: 2.7 }
    const ts = { superplasticizerDosageBase_C30: 1.8 }
    const spR = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand, spStd, ts)
    const rate = await MixDesignService_Aggregate.calculateWaterReducingRate(
      spStd.waterReducingRate,
      spR.baseDosage,
      spR.strengthDosage, // 关键：用 strengthDosage（1.8）而不是 finalDosage（2.3）
      spStd,
      null
    )
    expect(rate).toBe(34) // 不受砂石微调影响
  })

  test('场景 D：没选减水剂 → 全 0', async () => {
    const sand = { mbValue: 0.5, finenessModulus: 2.7 }
    const r = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand, null, null)
    expect(r.hasSuperplasticizer).toBe(false)
    expect(r.strengthDosage).toBe(0)
    expect(r.finalDosage).toBe(0)
    expect(r.baseDosage).toBe(0)
  })

  test('场景 E：没选减水剂 + 有砂子 → 仍全 0（不计算微调）', async () => {
    const sand = { mbValue: 1.0, finenessModulus: 2.7 } // 即便有微调，也不算
    const r = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand, null, null)
    expect(r.hasSuperplasticizer).toBe(false)
    expect(r.mbAdjustment).toBe(0)
    expect(r.fmAdjustment).toBe(0)
    expect(r.finalDosage).toBe(0)
  })
})
