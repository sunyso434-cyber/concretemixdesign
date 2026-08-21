// SalesQuoteCalculationService 核心路径单元测试（优化项 6）
// 覆盖：辅助函数边界、正向基础报价（calculate）、反向套价（calculateReverse 含三种包装策略）、
// 正向议价三档价（calculateForward 含设备摊销）
const {
  calculate,
  calculateReverse,
  calculateForward,
  roundMoney,
  normalizeRate,
} = require('../SalesQuoteCalculationService')

describe('辅助函数', () => {
  test('roundMoney 保留 6 位小数并四舍五入', () => {
    expect(roundMoney(0.1234567)).toBe(0.123457)
    expect(roundMoney(1)).toBe(1)
    expect(roundMoney(NaN)).toBe(0)
    expect(roundMoney('12.3456789')).toBe(12.345679)
  })

  test('normalizeRate：小于等于 1 视为小数，大于 1 视为百分比', () => {
    expect(normalizeRate(0.1)).toBe(0.1)
    expect(normalizeRate(10)).toBe(0.1)
    expect(normalizeRate('0.2')).toBe(0.2)
    expect(normalizeRate('abc')).toBe(0)
    expect(normalizeRate(undefined)).toBe(0)
  })
})

describe('calculate（正向基础报价）', () => {
  const basicMix = {
    strengthGrade: 'C30',
    concreteType: '普通',
    slump: 180,
    materials: [
      { materialId: 1, materialName: '水泥', usage: 300, price: 500 },
      { materialId: 2, materialName: '砂', usage: 200, price: 90 },
    ],
  }

  test('完整算价链路：材料成本/市场调整/费用/利润/税费/运输/泵送', () => {
    const result = calculate({
      basicMix,
      pricing: {
        marketAdjustmentRate: 0.05,   // 材料成本 168 → 调整 8.4
        manufacturingFee: 50,
        technicalServiceFee: 10,
        profitRate: 0.10,
        transportDistance: 30,
        transportUnitPrice: 2.5,      // 运输费 75
        pumpingFee: 8,
        vatRate: 0.13,
        quoteRangeDelta: 10,
      },
    })
    expect(result.materialCostSubtotal).toBe(168)          // 300×500/1000 + 200×90/1000
    expect(result.marketAdjustmentAmount).toBe(8.4)
    expect(result.costBase).toBe(236.4)
    expect(result.baseProfit).toBe(23.64)
    expect(result.transportFee).toBe(75)
    expect(result.preTaxPrice).toBe(343.04)
    expect(result.vatAmount).toBe(44.5952)
    expect(result.suggestedDealPrice).toBe(387.6352)
    expect(result.quoteRange).toEqual({ min: 377.6352, max: 397.6352 })
    expect(result.includes).toEqual({ transport: true, vat: true })
  })

  test('材料明细逐项成本 = 用量×单价/1000', () => {
    const result = calculate({ basicMix, pricing: {} })
    expect(result.materialDetails[0]).toMatchObject({ usage: 300, unitPrice: 500, cost: 150 })
    expect(result.materialDetails[1]).toMatchObject({ usage: 200, unitPrice: 90, cost: 18 })
  })

  test('材料无单价时抛错', () => {
    const mix = { ...basicMix, materials: [{ materialId: 1, materialName: '水泥', usage: 300 }] }
    expect(() => calculate({ basicMix: mix, pricing: {} })).toThrow('没有单价')
  })

  test('缺 basicMix / 无材料时抛错', () => {
    expect(() => calculate({ basicMix: null, pricing: {} })).toThrow('缺少基础配合比')
    expect(() => calculate({ basicMix: { materials: [] }, pricing: {} })).toThrow('没有材料用量')
  })
})

describe('calculateReverse（反向套价）', () => {
  const materials = [
    { materialId: 1, materialName: '水泥', usage: 350, price: 400 },
  ]
  // 默认费用：制造 18 + 人工 10 + 运输 20×2.5=50 → 固定费 78；材料成本 140 → 总成本 218

  test('目标市价落在利润安全区间内：不包装，直接反推', () => {
    const result = calculateReverse({ materials, targetUnitPrice: 250, vatRate: 0.13 })
    // 250/1.13 = 221.2389 → 初始利润 3.2389 → 利润率 ≈ 1.49% ∈ [0.5%, 3%]
    expect(result.polished).toBe(false)
    expect(result.targetPreTax).toBe(221.238938)
    expect(result.totalCost).toBe(218)
    expect(result.actualProfitRate).toBeGreaterThanOrEqual(0.005)
    expect(result.actualProfitRate).toBeLessThanOrEqual(0.03)
    expect(result.suggestedDealPrice).toBe(250)
  })

  test('市价过高（利润率超上限）：material_price 包装把利润率拉回安全区间', () => {
    const result = calculateReverse({ materials, targetUnitPrice: 280, vatRate: 0.13 })
    expect(result.polished).toBe(true)
    expect(result.polishStrategy).toBe('material_price')
    expect(result.actualProfitRate).toBeGreaterThanOrEqual(0.005)
    expect(result.actualProfitRate).toBeLessThanOrEqual(0.03)
    // 包装后的材料单价 ≠ 原始单价
    expect(result.materialDetails[0].unitPrice).not.toBe(400)
    expect(result.warning).toBeNull()
  })

  test('polishStrategy=none 时只告警不调价', () => {
    const result = calculateReverse({ materials, targetUnitPrice: 280, polishStrategy: 'none', vatRate: 0.13 })
    expect(result.polished).toBe(false)
    expect(result.materialDetails[0].unitPrice).toBe(400)
    expect(result.warning).toContain('偏离安全区间')
  })

  test('制造费包装：超过 1.5× 上限时告警', () => {
    const result = calculateReverse({
      materials,
      targetUnitPrice: 280,
      polishStrategy: 'manufacturing',
      vatRate: 0.13,
    })
    expect(result.polished).toBe(true)
    // 默认制造费 18，target 远超 27 上限 → 告警
    expect(result.warning).toContain('超过')
  })

  test('入参校验：缺材料 / 非法市价抛错', () => {
    expect(() => calculateReverse({ materials: [], targetUnitPrice: 250 })).toThrow('缺少材料用量')
    expect(() => calculateReverse({ materials, targetUnitPrice: 0 })).toThrow('缺少有效的目标市价')
  })
})

describe('calculateForward（正向议价三档价）', () => {
  const materials = [
    { materialId: 1, materialName: '水泥', usage: 350, price: 400 },
  ]

  test('三档价单调递增且含税计算正确', () => {
    const result = calculateForward({ materials, vatRate: 0.13 })
    // 材料 140 + 默认制造 18 + 人工 10 + 运输 50 = 218
    expect(result.totalCost).toBe(218)
    expect(result.minPrice).toBeLessThan(result.suggestedPrice)
    expect(result.suggestedPrice).toBeLessThan(result.maxPrice)
    // min = 218×1.10×1.13 = 270.974；suggested = 218×1.25×1.13 = 307.925；max = 218×1.40×1.13 = 344.876
    expect(result.minPrice).toBe(270.974)
    expect(result.suggestedPrice).toBe(307.925)
    expect(result.maxPrice).toBe(344.876)
    expect(result.profitRange).toEqual({ min: 0.1, mid: 0.25, max: 0.4 })
  })

  test('设备摊销：采购价 ÷ 预计总方量，订单量核算总摊销', () => {
    const result = calculateForward({
      materials,
      equipmentAmortization: {
        purchaseCost: 100000,
        totalAmortizeVolume: 5000,
        currentOrderVolume: 100,
      },
      vatRate: 0.13,
    })
    expect(result.equipmentUnitAmortization).toBe(20)     // 100000/5000
    expect(result.equipmentTotalAmortization).toBe(2000)  // 20×100
    // 总成本应包含摊销 20/方
    expect(result.totalCost).toBe(238)
  })

  test('设备摊销预计总方量必须大于 0', () => {
    expect(() => calculateForward({
      materials,
      equipmentAmortization: { purchaseCost: 100000, totalAmortizeVolume: 0 },
    })).toThrow('预计总方量必须大于 0')
  })

  test('缺材料时抛错', () => {
    expect(() => calculateForward({ materials: [] })).toThrow('缺少材料用量')
  })
})

