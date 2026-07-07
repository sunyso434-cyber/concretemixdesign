/**
 * 复现回归测试：用户没传某掺合料 ID 时，optimizer 不应让该掺合料掺量 > 0
 *
 * Bug 历史：
 *   2026-07-07 老板实测：optimize_mix_cost 调 lithiumSlagIds=[] 或不传，
 *   bestSolution.materials.lithiumSlag 仍为 50.14 kg
 *
 *   教训：
 *     - v10.7.6 第一版 patch 只修了 _firstLayerFilter，但优化器主流程实际从 _stage2Filter 开始，
 *       _firstLayerFilter 是孤儿函数（无调用方）。v10.7.6 第一版完全没起作用。
 *     - v10.7.6 第二版 patch 补修了 _stage2Filter 并加了本测试覆盖主路径，
 *       真正解决老板实测问题。
 *
 *   根因（双层漏洞）：
 *   - src/main/services/MixDesignOptimizer.js:677-698 _stage2Filter / :809-820 _firstLayerFilter
 *     任务生成时掺合料材料为 null 但掺量 > 0 仍生成 task
 *   - src/main/services/MixDesignService/MixDesignService_Database.js:391
 *     直接用 lithiumSlagPercentage 计算 lithiumSlag 用量，不校验 materials.lithiumSlag
 */

// SystemService mock
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

describe('MixDesignOptimizer 空掺合料材料不应出现掺量', () => {
  test('未传 lithiumSlag 时，bestSolution 不应含 lithiumSlag > 0', async () => {
    const opt = MixDesignOptimizer

    // 用户场景：传水泥 + 砂 + 石 + 粉煤灰 + 矿渣，**不传 lithiumSlag**，
    // 但 lithiumSlagRange 默认 [0, 20] 仍启用。
    const results = await opt._firstLayerFilter({
      materials: {
        cement: [{ id: 55, name: 'P.O42.5', price: 480, compressiveStrength28d: 48 }],
        sand: [{ id: 66, name: '中砂', finenessModulus: 2.6, mbValue: 0.5, price: 150 }],
        stone: [{ id: 76, name: '碎石5-20', specification: '5-20mm', price: 120 }],
        flyAsh: [{ id: 58, name: 'II级粉煤灰', price: 180, waterDemandRatio: 92 }],
        slag: [{ id: 60, name: 'S95矿渣粉', price: 220, waterDemandRatio: 95 }],
        lithiumSlag: [],          // ← 关键：空数组（用户没传 ID）
        compositePowder: [],      // ← 关键：空数组
        superplasticizer: [{ id: 81, name: '聚羧酸减水剂', price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 }]
      },
      waterRatio: 0.55,
      flyAshRange: [0, 10, 20],
      slagRange: [0, 10, 15],
      lithiumSlagRange: [0, 10, 15, 20],    // 范围默认开启，但材料空
      compositePowderRange: [0, 10, 15, 20],
      fineAggregateRatios: [[1.0]],
      maxAdmixtureRatio: 50,
      constraints: { strength: 'C30', slump: 180 },
      cancellationToken: { cancelled: false }
    })

    // 断言 1：所有 valid 结果中，params.lithiumSlag 必须为 0
    const lithiumSlagContaminated = results.filter(r => r.params.lithiumSlag > 0)
    expect(lithiumSlagContaminated).toEqual([])

    // 断言 2：所有 valid 结果中，result.materials.lithiumSlag 必须为 0
    const lithiumSlagInKg = results.filter(r => (r.materials?.lithiumSlag || 0) > 0)
    expect(lithiumSlagInKg).toEqual([])

    // 断言 3：compositePowder 同样不应出现
    const compositePowderInKg = results.filter(r => (r.materials?.compositePowder || 0) > 0)
    expect(compositePowderInKg).toEqual([])
  })

  test('未传 flyAsh/slag 时同理不出现掺量（覆盖同一修复逻辑）', async () => {
    const opt = MixDesignOptimizer
    const results = await opt._firstLayerFilter({
      materials: {
        cement: [{ id: 55, name: 'P.O42.5', price: 480, compressiveStrength28d: 48 }],
        sand: [{ id: 66, name: '中砂', finenessModulus: 2.6, mbValue: 0.5, price: 150 }],
        stone: [{ id: 76, name: '碎石5-20', specification: '5-20mm', price: 120 }],
        flyAsh: [],           // ← 空
        slag: [],             // ← 空
        lithiumSlag: [{ id: 84, name: '锂渣', price: 60, waterDemandRatio: 95 }],
        compositePowder: [],
        superplasticizer: [{ id: 81, name: '聚羧酸减水剂', price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 }]
      },
      waterRatio: 0.55,
      flyAshRange: [0, 10, 20],
      slagRange: [0, 10, 15],
      lithiumSlagRange: [0, 10, 15],
      compositePowderRange: [0, 10, 15],
      fineAggregateRatios: [[1.0]],
      maxAdmixtureRatio: 50,
      constraints: { strength: 'C30', slump: 180 },
      cancellationToken: { cancelled: false }
    })

    const flyAshContaminated = results.filter(r => (r.materials?.flyAsh || 0) > 0)
    const slagContaminated = results.filter(r => (r.materials?.slag || 0) > 0)
    expect(flyAshContaminated).toEqual([])
    expect(slagContaminated).toEqual([])
  })

  /**
   * 关键测试（v10.7.6 第二版必修）：
   * 主流程从 _stage2Filter 开始（_firstLayerFilter 是孤儿函数），
   * _stage2Filter 也要有同样过滤。这一测之前只在 _firstLayerFilter 测了等于没测主路径。
   */
  test('_stage2Filter (主流程入口)：top5 不应含 (空材料 + 掺量>0) 的组合', async () => {
    const opt = MixDesignOptimizer
    const stage2R = await opt._stage2Filter({
      materials: {
        cement: [{ id: 55, name: 'P.O42.5', price: 480, compressiveStrength28d: 48 }],
        flyAsh: [{ id: 58, name: 'II级粉煤灰', price: 180, waterDemandRatio: 92 }],
        slag: [{ id: 60, name: 'S95矿渣粉', price: 220, waterDemandRatio: 95 }],
        lithiumSlag: [],          // ← 关键：空
        compositePowder: [],      // ← 关键：空
        superplasticizer: [{ id: 81, name: '聚羧酸减水剂', price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 }]
      },
      baseWaterAmount: 180,
      defaultSpDosage: 1.5,
      defaultSp: { id: 81, price: 5000, waterReducingRate: 25, recommendedDosage: 1.5 },
      flyAshRange: [0, 10, 20],
      slagRange: [0, 10, 15],
      lithiumSlagRange: [0, 10, 15, 20],    // 范围默认开启
      compositePowderRange: [0, 10, 15, 20],
      maxAdmixtureRatio: 50,
      constraints: { strength: 'C30', slump: 180 },
      cancellationToken: { cancelled: false }
    })

    // 任何 top5 组合都不应同时有 (lithiumSlagMat===null && lithiumSlagDosage>0)
    const contaminated = stage2R.top5.filter(t =>
      (!t.lithiumSlagMat && t.lithiumSlag > 0) ||
      (!t.compositePowderMat && t.compositePowder > 0)
    )
    expect(contaminated).toEqual([])
  })
})
