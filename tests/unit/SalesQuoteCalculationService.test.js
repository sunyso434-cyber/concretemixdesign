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
      transportFee: 12,
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