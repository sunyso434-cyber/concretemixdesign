const assert = require('assert')
const path = require('path')

const SalesQuoteCalculationService = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'services',
  'SalesQuoteCalculationService'
))

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

const basicMix = {
  strengthGrade: 'C35',
  concreteType: '抗渗',
  slump: 180,
  materials: [
    { materialId: 1, materialType: '水泥', materialName: 'P.O 42.5', usage: 320, price: 360 },
    { materialId: 2, materialType: '粉煤灰', materialName: 'II级粉煤灰', usage: 60, price: 180 },
    { materialId: 3, materialType: '细骨料', materialName: '机制砂', usage: 780, price: 95 },
    { materialId: 4, materialType: '粗骨料', materialName: '碎石', usage: 1040, price: 80 },
    { materialId: 5, materialType: '减水剂', materialName: '聚羧酸', usage: 7.6, price: 4200 }
  ]
}

run('calculates material detail per cubic meter from usage and current price', () => {
  const result = SalesQuoteCalculationService.calculate({
    basicMix,
    pricing: {
      marketAdjustmentRate: 0,
      manufacturingFee: 18,
      technicalServiceFee: 20,
      profitRate: 0.12,
      transportDistance: 0.6,
      transportUnitPrice: 20,
      pumpingFee: 15,
      vatRate: 0.13,
      quoteRangeDelta: 5
    }
  })

  assert.strictEqual(result.materialDetails.length, 5)
  assert.strictEqual(result.materialDetails[0].cost, 115.2)
  assert.strictEqual(result.materialCostSubtotal, 315.22)
  assert.strictEqual(result.manufacturingFee, 18)
  assert.strictEqual(result.technicalServiceFee, 20)
  assert.strictEqual(result.transportFee, 12)
  assert.strictEqual(result.pumpingFee, 15)
  assert.strictEqual(result.vatRate, 0.13)
  assert.strictEqual(result.preTaxPrice, 422.6064)
  assert.strictEqual(result.vatAmount, 54.938832)
  assert.strictEqual(result.suggestedDealPrice, 477.545232)
  assert.deepStrictEqual(result.quoteRange, { min: 472.545232, max: 482.545232 })
})

run('applies one-time material price overrides without mutating input mix', () => {
  const result = SalesQuoteCalculationService.calculate({
    basicMix,
    pricing: {
      materialPriceOverrides: { 1: 370 },
      marketAdjustmentRate: 0.03,
      manufacturingFee: 18,
      technicalServiceFee: 20,
      profitRate: 0.1,
      transportFee: 0,
      pumpingFee: 0,
      vatRate: 0.13,
      quoteRangeDelta: 0
    }
  })

  const cement = result.materialDetails.find(item => item.materialId === 1)
  assert.strictEqual(cement.unitPrice, 370)
  assert.strictEqual(cement.cost, 118.4)
  assert.strictEqual(basicMix.materials[0].price, 360)
  assert.ok(result.marketAdjustmentAmount > 0)
})

run('throws a clear error when a material has no price', () => {
  assert.throws(() => {
    SalesQuoteCalculationService.calculate({
      basicMix: {
        ...basicMix,
        materials: [{ materialId: 9, materialType: '水泥', materialName: '无价水泥', usage: 300 }]
      },
      pricing: {
        marketAdjustmentRate: 0,
        manufacturingFee: 18,
        technicalServiceFee: 20,
        profitRate: 0.12,
        transportFee: 12,
        pumpingFee: 15,
        vatRate: 0.13,
        quoteRangeDelta: 5
      }
    })
  }, /无价水泥.*没有单价/)
})

// ────────────────────────────────────────────────────────────────
// v10.10 新增：calculateReverse / calculateForward 测试
// ────────────────────────────────────────────────────────────────

const reverseMaterials = basicMix.materials

run('reverse: profit in safe range → no polish', () => {
  // 真实成本 393.22(材料 315.22 + 固定费用 78); 目标 450.55 元/m³ → 利润 ~1.4% 在 [0.5%, 3%]
  const r = SalesQuoteCalculationService.calculateReverse({
    materials: reverseMaterials,
    targetUnitPrice: 450.55,
    polishStrategy: 'material_price',
    strengthGrade: 'C35',
    concreteType: '普通'
  })
  assert.strictEqual(r.mode, 'reverse')
  assert.strictEqual(r.polished, false)
  assert.ok(r.actualProfitRate >= 0.005 && r.actualProfitRate <= 0.03, `expected profit in [0.5%, 3%], got ${(r.actualProfitRate * 100).toFixed(2)}%`)
  assert.strictEqual(r.suggestedDealPrice, 450.55)
})

run('reverse: profit too high (5%) → material_price polish caps at 3%', () => {
  // 目标 466.49 元/m³ → 实际利润 ~5% 触发 material_price 包装
  const r = SalesQuoteCalculationService.calculateReverse({
    materials: reverseMaterials,
    targetUnitPrice: 466.49,
    polishStrategy: 'material_price',
    strengthGrade: 'C35',
    concreteType: '普通'
  })
  assert.strictEqual(r.polished, true)
  assert.strictEqual(r.polishStrategy, 'material_price')
  assert.ok(r.actualProfitRate <= 0.03 + 0.0001, `expected profit <= 3%, got ${(r.actualProfitRate * 100).toFixed(2)}%`)
  // 包装边界:单价不超过原单价 × 1.3
  for (const p of r.polishedUnitPrices) {
    if (p.polishedPrice > p.originalPrice) {
      assert.ok(p.polishedPrice <= p.originalPrice * 1.3 + 0.01, `${p.materialName} price ${p.polishedPrice} > 1.3× original ${p.originalPrice}`)
    }
  }
})

run('reverse: loss scenario → polish to 0.5% floor', () => {
  // 目标 380 元/m³ → 亏本,包装到 0.5%
  const r = SalesQuoteCalculationService.calculateReverse({
    materials: reverseMaterials,
    targetUnitPrice: 380,
    polishStrategy: 'material_price',
    strengthGrade: 'C35',
    concreteType: '普通'
  })
  assert.strictEqual(r.polished, true)
  assert.ok(r.actualProfitRate >= 0.005 - 0.0001, `expected profit >= 0.5%, got ${(r.actualProfitRate * 100).toFixed(2)}%`)
  // 包装边界:单价不低于 0.7× 原价
  for (const p of r.polishedUnitPrices) {
    if (p.polishedPrice < p.originalPrice) {
      assert.ok(p.polishedPrice >= p.originalPrice * 0.7 - 0.01, `${p.materialName} price ${p.polishedPrice} < 0.7× original ${p.originalPrice}`)
    }
  }
})

run('reverse: polishStrategy=none with loss → no polish + warning', () => {
  const r = SalesQuoteCalculationService.calculateReverse({
    materials: reverseMaterials,
    targetUnitPrice: 380, // 严重亏本
    polishStrategy: 'none',
    strengthGrade: 'C35',
    concreteType: '普通'
  })
  assert.strictEqual(r.polished, false)
  assert.ok(r.warning, 'expected warning for loss scenario')
  assert.ok(r.warning.includes('偏离安全区间'))
})

run('reverse: polishStrategy=manufacturing → manufacturing fee adjusted within 1.5× bound', () => {
  const r = SalesQuoteCalculationService.calculateReverse({
    materials: reverseMaterials,
    targetUnitPrice: 480,
    polishStrategy: 'manufacturing',
    strengthGrade: 'C35',
    concreteType: '普通'
  })
  assert.strictEqual(r.polished, true)
  assert.ok(r.manufacturingFee >= 0, 'manufacturing fee should not be negative')
  assert.ok(r.manufacturingFee <= 18 * 1.5 + 0.01, `manufacturing fee ${r.manufacturingFee} > 1.5× default 18`)
})

run('forward: no equipment amortization → 3-tier price math correct', () => {
  const r = SalesQuoteCalculationService.calculateForward({
    materials: reverseMaterials,
    strengthGrade: 'C35',
    concreteType: '特殊'
  })
  assert.strictEqual(r.mode, 'forward')
  // 三档利润率 10% / 25% / 40%(mid = (10+40)/2 = 25%)
  assert.strictEqual(r.profitRange.min, 0.10)
  assert.strictEqual(r.profitRange.max, 0.40)
  assert.strictEqual(r.profitRange.mid, 0.25)
  // 数学验证:minPrice = totalCost × 1.10 × 1.13
  const expectedMin = r.totalCost * 1.10 * 1.13
  assert.ok(Math.abs(r.minPrice - expectedMin) < 0.01, `minPrice ${r.minPrice} != expected ${expectedMin.toFixed(2)}`)
  // maxPrice = totalCost × 1.40 × 1.13
  const expectedMax = r.totalCost * 1.40 * 1.13
  assert.ok(Math.abs(r.maxPrice - expectedMax) < 0.01, `maxPrice ${r.maxPrice} != expected ${expectedMax.toFixed(2)}`)
})

run('forward: equipment amortization = purchaseCost / totalAmortizeVolume', () => {
  const r = SalesQuoteCalculationService.calculateForward({
    materials: reverseMaterials,
    equipmentAmortization: { purchaseCost: 500000, totalAmortizeVolume: 50000, currentOrderVolume: 1000 },
    strengthGrade: 'C35',
    concreteType: '特殊'
  })
  // 单方设备摊销 = 500000 / 50000 = 10 元/m³
  assert.strictEqual(r.equipmentUnitAmortization, 10)
  // 本次总摊销 = 10 × 1000 = 10000 元
  assert.strictEqual(r.equipmentTotalAmortization, 10000)
})

run('forward: 3-tier price ratio correct (10% : 25% : 40%)', () => {
  const r = SalesQuoteCalculationService.calculateForward({
    materials: reverseMaterials,
    strengthGrade: 'C35',
    concreteType: '特殊'
  })
  // 验证三档比例 (1.10 : 1.25 : 1.40) 减去增值税后仍保持
  const minPreTax = r.minPrice / 1.13
  const midPreTax = r.suggestedPrice / 1.13
  const maxPreTax = r.maxPrice / 1.13
  // 利润率 = (preTax - totalCost) / totalCost
  const minRate = (minPreTax - r.totalCost) / r.totalCost
  const midRate = (midPreTax - r.totalCost) / r.totalCost
  const maxRate = (maxPreTax - r.totalCost) / r.totalCost
  assert.ok(Math.abs(minRate - 0.10) < 0.001, `minRate ${minRate} != 0.10`)
  assert.ok(Math.abs(midRate - 0.25) < 0.001, `midRate ${midRate} != 0.25`)
  assert.ok(Math.abs(maxRate - 0.40) < 0.001, `maxRate ${maxRate} != 0.40`)
})

run('reverse: salesFee / financeFee / pumpingFee are included in totalCost', () => {
  const r = SalesQuoteCalculationService.calculateReverse({
    materials: reverseMaterials,
    targetUnitPrice: 450.55,
    fixedFees: { salesFee: 5, financeFee: 3, pumpingFee: 12 },
    strengthGrade: 'C35',
    concreteType: '普通'
  })
  assert.strictEqual(r.salesFee, 5)
  assert.strictEqual(r.financeFee, 3)
  assert.strictEqual(r.pumpingFee, 12)
  const expectedTotalCost = r.materialCostSubtotal + r.manufacturingFee + r.laborFee +
    r.technicalServiceFee + r.salesFee + r.financeFee + r.transportFee + r.pumpingFee + r.equipmentFee
  assert.strictEqual(r.totalCost, expectedTotalCost)
})

run('forward: salesFee / financeFee / pumpingFee affect totalCost', () => {
  const base = SalesQuoteCalculationService.calculateForward({
    materials: reverseMaterials,
    strengthGrade: 'C35',
    concreteType: '特殊'
  })
  const withFees = SalesQuoteCalculationService.calculateForward({
    materials: reverseMaterials,
    fixedFees: { salesFee: 5, financeFee: 3, pumpingFee: 12 },
    strengthGrade: 'C35',
    concreteType: '特殊'
  })
  const expectedDelta = 5 + 3 + 12
  assert.strictEqual(withFees.totalCost - base.totalCost, expectedDelta)
  assert.ok(Math.abs(withFees.suggestedPrice - base.suggestedPrice - expectedDelta * 1.25 * 1.13) < 0.01)
})