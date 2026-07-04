/**
 * 5 阶段成本优化器端到端测试（手跑脚本）
 * 用法: node tests/manual/test-costs.js
 */
const MixDesignService = require('../../src/main/services/MixDesignService')
const MixDesignOptimizer = require('../../src/main/services/MixDesignOptimizer')

// mock SystemService 默认参数，避免数据库依赖
const SystemService = require('../../src/main/services/SystemService')
SystemService.getParamByName = async (name) => {
  const map = {
    'strengthStdDev_C20': { value: '4.0' },
    'strengthStdDev_C25': { value: '5.0' },
    'strengthStdDev_C30': { value: '5.0' },
    'strengthStdDev_C50': { value: '6.0' },
    'regressionAlphaA': { value: '0.53' },
    'regressionAlphaB': { value: '0.20' },
    'waterReducingRatePer01Dosage': { value: '2.0' }
  }
  return map[name] || null
}

async function run() {
  const optimizer = require('../../src/main/services/MixDesignOptimizer')
  // ponytail: optimizer 是单例，progressCallback 通过 optimizeMixDesign 第三参数传
  const progressCallback = (progress) => {
    console.log(`  进度 [${progress.phase}]: ${progress.message} (${progress.current}/${progress.total})`)
  }

  const params = {
    constraints: {
      strength: 'C30',
      slump: 120,
      materials: {
        cement: [{ id: 1, name: 'P·O 42.5R水泥', price: 480, compressiveStrength28d: 48 }],
        flyAsh: [{ id: 3, name: 'I级粉煤灰', price: 180, waterDemandRatio: 92 }],
        slag: [{ id: 5, name: 'S95矿渣粉', price: 220, fluidityRatio: 98 }],
        lithiumSlag: [],
        compositePowder: [],
        sand: [{ id: 7, name: '机制砂', price: 150, finenessModulus: 2.8, mbValue: 0.6 }],
        stone: [{ id: 9, name: '碎石5-20mm', price: 120, specification: '5-20mm' }],
        superplasticizer: [{ id: 11, name: '聚羧酸减水剂（标准型）', price: 3500, recommendedDosage: 1.5, waterReducingRate: 25 }]
      }
    },
    userLimits: {
      flyAshRange: [0, 30],
      slagRange: [0, 20],
      gridStep: 5
    },
    maxAdmixtureRatio: 50
  }

  console.log('=== 开始 5 阶段成本优化 ===')
  const start = Date.now()

  const result = await optimizer.optimizeMixDesign(params, { cancelled: false }, progressCallback)
  const elapsed = Date.now() - start

  console.log(`\n=== 完成 ===`)
  console.log(`耗时: ${elapsed} ms`)
  console.log(`总评估组合数: ${result.totalEvaluated}`)
  console.log(`备选方案数: ${result.alternatives.length}\n`)

  console.log('=== 最佳方案 ===')
  const best = result.bestSolution
  console.log(`  总成本: ${best.totalCost?.toFixed(2)} 元/m³`)
  console.log(`  水胶比: ${best.waterRatio?.toFixed(3)}`)
  console.log(`  砂率: ${best.sandRatio}%`)
  console.log(`  水泥: ${best.materials?.cement} kg/m³`)
  console.log(`  粉煤灰: ${best.materials?.flyAsh || 0} kg/m³`)
  console.log(`  矿渣粉: ${best.materials?.slag || 0} kg/m³`)
  console.log(`  用水: ${best.materials?.water} kg/m³`)
  console.log(`  砂: ${best.materials?.sand} kg/m³`)
  console.log(`  石: ${best.materials?.stone} kg/m³`)
}

run().catch(e => {
  console.error('测试失败:', e)
  process.exit(1)
})
