const path = require('path')
const assert = require('assert')

process.env.USER_DATA_PATH = path.join(__dirname, '..', '..', 'src', 'test-user-data')

const { sequelize, syncModels } = require(path.join(__dirname, '..', '..', 'src', 'main', 'db', 'database'))
const BasicMixDesignService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'BasicMixDesignService'))
const SalesQuoteRuleService = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'SalesQuoteRuleService'))

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

  await sequelize.close()
}

main()