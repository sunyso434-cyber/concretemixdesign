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

  await run('creates a custom sales quote rule and rejects duplicate type', async () => {
    const concreteType = `TDD-CUSTOM-${Date.now()}`
    const created = await SalesQuoteRuleService.createRule({
      concreteType,
      keywords: ['TDD-CUSTOM'],
      salesExplanation: 'custom rule for regression test',
      costDrivers: ['driver'],
      productionDifficulties: ['difficulty'],
      suggestedSlump: 180,
      suggestedManufacturingFee: 18,
      suggestedTechnicalServiceFee: 10,
      technicalServiceFeeRange: [5, 15],
      suggestedProfitRate: 0.12,
      suggestedTransportFee: 0,
      suggestedPumpingFee: 0,
      vatRate: 0.13,
      quoteRangeDelta: 5,
      enabled: true
    })

    assert.strictEqual(created.concreteType, concreteType)
    const matched = await SalesQuoteRuleService.findRuleByType(concreteType)
    assert.strictEqual(matched.id, created.id)

    await assert.rejects(
      () => SalesQuoteRuleService.createRule({
        concreteType,
        keywords: ['TDD-CUSTOM-DUPLICATE']
      }),
      /already exists|已存在|存在/
    )
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

  await run('updates and deletes basic mix design for manual maintenance', async () => {
    const mix = await BasicMixDesignService.createBasicMixDesign({
      name: 'C30普通手工维护配比',
      strengthGrade: 'C30',
      concreteType: '普通',
      slump: 160,
      materials: [
        { materialId: 1, materialType: '水泥', materialName: 'P.O 42.5', usage: 280 },
        { materialId: 3, materialType: '细骨料', materialName: '机制砂', usage: 820 }
      ],
      isDefault: false,
      remarks: '待编辑'
    })

    const updated = await BasicMixDesignService.updateBasicMixDesign(mix.id, {
      name: 'C30普通已编辑配比',
      slump: 180,
      materials: [
        { materialId: 1, materialType: '水泥', materialName: 'P.O 42.5', usage: 300 },
        { materialId: 3, materialType: '细骨料', materialName: '机制砂', usage: 800 }
      ],
      remarks: '已编辑'
    })

    assert.strictEqual(updated.name, 'C30普通已编辑配比')
    assert.strictEqual(updated.slump, 180)
    assert.strictEqual(updated.materials[0].usage, 300)

    await BasicMixDesignService.deleteBasicMixDesign(mix.id)
    const rows = await BasicMixDesignService.listBasicMixDesigns({ strengthGrade: 'C30', concreteType: '普通' })
    assert.ok(!rows.some(row => row.id === mix.id))
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
