const MixDesignService = require('../../src/main/services/MixDesignService')
// 为了在非完整应用环境中运行测试，mock SystemService.getParamByName 返回默认参数，避免数据库依赖
const SystemService = require('../../src/main/services/SystemService')
SystemService.getParamByName = async (name) => {
  const map = {
    'strengthStdDev_C20': { value: '4.0' },
    'strengthStdDev_C25': { value: '5.0' },
    'strengthStdDev_C50': { value: '6.0' },
    'regressionAlphaA': { value: '0.53' },
    'regressionAlphaB': { value: '0.20' },
    'waterReducingRatePer01Dosage': { value: '2.0' }
  }
  return map[name] || null
}

async function run() {
  const params = {
    strength: 'C30',
    slump: 120,
    environment: '1',
    calculationMethod: 'absolute',
    flyAshDosage: 20,
    slagDosage: 10,
    sandRatio: 35,
    tempSettings: null,
    materials: {
      cement: { id: 1, name: 'P·O 42.5R水泥', price: 480, compressiveStrength28d: 48 },
      flyAsh: { id: 3, name: 'I级粉煤灰', price: '180元/吨', waterDemandRatio: 92 },
      slag: { id: 5, name: 'S95矿渣粉', price: '220元/吨', fluidityRatio: 98 },
      sand: { id: 7, name: '机制砂', price: 150, finenessModulus: 2.8, mbValue: 0.6 },
      stone: { id: 9, name: '碎石', price: 120 },
      superplasticizer: { id: 11, name: '聚羧酸减水剂（标准型）', price: '3500元/吨', recommendedDosage: 1.5, waterReducingRate: 25, density: 1.05 }
    }
  }

  console.log('调用 calculateMixDesign 进行成本计算...')
  const result = await MixDesignService.calculateMixDesign(params)

  console.log('\n计算结果：')
  console.log('材料用量:', result.materials)
  console.log('材料成本:', result.materialCosts)
  console.log('总成本:', result.totalCost)
}

run().catch(e => {
  console.error('测试失败:', e)
  process.exit(1)
})
