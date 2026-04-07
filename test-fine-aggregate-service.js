// 在非 Electron 环境下运行时，mock 掉对 electron.app.getPath 的调用，避免加载数据库时报错
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function (p) {
  if (p === 'electron') {
    return { app: { getPath: () => process.cwd() } }
  }
  return originalRequire.apply(this, arguments)
}

const MixDesignService = require('./src/main/services/MixDesignService')

async function run() {
  const sands = [
    { id: 1, name: '机制砂', finenessModulus: 3.0, mbValue: 0.5 },
    { id: 2, name: '河砂', finenessModulus: 2.4, mbValue: 0.5 }
  ]

  const strengths = ['C20', 'C25', 'C30', 'C35', 'C40', 'C50']

  for (const strength of strengths) {
    const targetFM = MixDesignService.computeTargetFinenessModulus(strength)
    const combined = MixDesignService.calculateCombinedFineAggregateParams(sands, targetFM)
    console.log(`\nStrength: ${strength}`)
    console.log('  targetFinenessModulus:', targetFM)
    console.log('  combined finenessModulus:', combined.finenessModulus)
    console.log('  optimal ratios:', combined.optimalRatio ? combined.optimalRatio.map(i => ({ id: i.aggregate.id, ratio: i.ratio })) : 'n/a')
  }
}

run().catch(err => { console.error(err); process.exit(1) })
