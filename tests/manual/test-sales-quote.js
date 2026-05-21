const path = require('path')
const assert = require('assert')

process.env.USER_DATA_PATH = path.join(__dirname, '..', '..', 'src', 'test-user-data')

const { sequelize, syncModels } = require(path.join(__dirname, '..', '..', 'src', 'main', 'db', 'database'))
const BasicMixDesignService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'BasicMixDesignService'))
const SalesQuoteRuleService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'SalesQuoteRuleService'))
const SalesQuoteCalculationService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'SalesQuoteCalculationService'))

async function run(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

async function main() {
  await sequelize.authenticate()
  await syncModels()

  await run('initializes default sales quote rules', async () => {
    await SalesQuoteRuleService.initDefaultRules()
    const rules = await SalesQuoteRuleService.listRules()
    assert.ok(rules.some(rule => rule.concreteType === '抗渗'))
    assert.ok(rules.some(rule => rule.keywords.includes('P8')))
  })

  await run('creates and resolves default basic mix design', async () => {
    const mix = await BasicMixDesignService.createBasicMixDesign({
      name: 'C35抗渗默认报价配比',
      strengthGrade: 'C35',
      concreteType: '抗渗',
      slump: 180,
      materials: [
        { materialId: 1, materialType: '水泥', materialName: 'P.O 42.5', usage: 320 },
        { materialId: 2, materialType: '粉煤灰', materialName: 'II级粉煤灰', usage: 60 }
      ],
      isDefault: true,
      remarks: '手工测试'
    })

    const resolved = await BasicMixDesignService.findDefaultMix('C35', '抗渗')
    assert.strictEqual(resolved.id, mix.id)
    assert.strictEqual(resolved.materials[0].usage, 320)
  })

  await run('calculates quote from default basic mix and rule suggestions', async () => {
    const mix = await BasicMixDesignService.findDefaultMix('C35', '抗渗')
    const rule = await SalesQuoteRuleService.findRuleByType('抗渗')
    const quote = SalesQuoteCalculationService.calculate({
      basicMix: {
        strengthGrade: mix.strengthGrade,
        concreteType: mix.concreteType,
        slump: mix.slump,
        materials: mix.materials.map(item => ({ ...item, price: 360 }))
      },
      pricing: {
        manufacturingFee: rule.suggestedManufacturingFee,
        technicalServiceFee: rule.suggestedTechnicalServiceFee,
        profitRate: rule.suggestedProfitRate,
        transportFee: rule.suggestedTransportFee,
        pumpingFee: rule.suggestedPumpingFee,
        vatRate: rule.vatRate,
        quoteRangeDelta: rule.quoteRangeDelta
      }
    })
    assert.ok(quote.suggestedDealPrice > quote.materialCostSubtotal)
    assert.strictEqual(quote.vatRate, 0.13)
  })

  await sequelize.close()
}

main()