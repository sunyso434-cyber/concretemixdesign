/**
 * 分析 GA 搜索空间里用水量的可达范围
 * 目的：验证"为什么 GA 找不到 145 用水量的方案"
 *
 * 方法：枚举减水剂掺量从 1.0% 到 5.0%，看用水量怎么变
 * 预期：如果 bug C 存在（减水剂基因不影响减水率），用水量应该不随掺量变化
 */
const path = require('path')

// 复用测算脚本里的模型加载和材料
const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models')

const MATERIALS = {
  cement:    { id: 56, price: 308,  density: 3.1,  strength28d: 53.5 },
  lithiumSlag: { id: 84, price: 63, density: 2.5, activityIndex28d: 95, waterDemandRatio: 102 },
  compositePowder: { id: 64, price: 123, density: 2.8, activityIndex28d: 89, fluidityRatio: 102 },
  sand:      { id: 70, price: 93,   density: 2.66, finenessModulus: 2.63, mbValue: 0.25 },
  stone:     { id: 78, price: 87,   density: 2.7 },
  sp:        { id: 82, price: 1150, density: 1.05, waterReducingRate: 29, solidContent: 13, recommendedDosage: 2.7 },
  water:     { id: 46, price: 4,    density: 1 }
}

async function main() {
  // 动态加载项目服务（避免重复实现配合比计算）
  const MixDesignService_Database = require('../src/main/services/MixDesignService/MixDesignService_Database')
  const CandidatePoolBuilder = require('../src/main/services/CandidatePoolBuilder')

  // 构建候选池快照（模拟 GA 调用）
  const materialIds = {
    cementIds: [56], flyAshIds: [], slagIds: [61], lithiumSlagIds: [84],
    compositePowderIds: [64], sandIds: [70, 71], stoneIds: [78], spIds: [82], waterIds: [46]
  }
  const snapshot = await CandidatePoolBuilder.buildSnapshot(materialIds)

  console.log('='.repeat(80))
  console.log('GA 搜索空间用水量可达性分析')
  console.log('='.repeat(80))
  console.log('固定：水胶比=0.60, 砂率=30, 锂渣17%, 复合粉30%')
  console.log('变量：减水剂掺量从 1.0% 扫到 5.0%')
  console.log('预期：如果 bug C 存在，用水量不随掺量变化；如果修复，用水量应随掺量增加而降低')
  console.log()

  console.log('减水剂掺量(%)  减水率(%)  用水量(kg/m³)  胶凝材料(kg/m³)  成本(元/m³)')
  console.log('-'.repeat(80))

  const results = []
  for (let spDosage = 1.0; spDosage <= 5.0; spDosage += 0.2) {
    try {
      const mixResult = await MixDesignService_Database.calculateMixDesign({
        strength: 'C45',
        slump: 210,
        materials: {
          cement: snapshot.candidatePools.cement[0],
          sand: snapshot.candidatePools.sand[0],
          stone: snapshot.candidatePools.stone[0],
          superplasticizer: snapshot.candidatePools.sp[0],
          lithiumSlag: snapshot.candidatePools.lithiumSlag[0],
          compositePowder: snapshot.candidatePools.compositePowder[0]
        },
        calculationMethod: 'mass',
        targetDensity: 2400,
        lithiumSlagDosage: 17,
        compositePowderDosage: 30,
        sandRatio: 30,
        waterRatio: 0.60,
        _overrideSpDosage: spDosage,
        _overrideWaterRatio: 0.60
      })

      const amounts = mixResult.materials || mixResult.materialAmounts || {}
      const water = amounts.water || 0
      const binder = (amounts.cement || 0) + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
      const cost =
        (amounts.cement || 0) * 308 / 1000 +
        (amounts.lithiumSlag || 0) * 63 / 1000 +
        (amounts.compositePowder || 0) * 123 / 1000 +
        water * 4 / 1000 +
        (amounts.sand || 0) * 93 / 1000 +
        (amounts.stone || 0) * 87 / 1000 +
        (amounts.superplasticizer || 0) * 1150 / 1000

      // 从计算步骤里提取减水率
      const step6 = (mixResult.calculationSteps || []).find(s => s.step === 6)
      let reducingRate = -1
      if (step6 && step6.details) {
        const rateDetail = step6.details.find(d => d.label === '减水率')
        if (rateDetail) reducingRate = parseFloat(rateDetail.value)
      }

      console.log(`${spDosage.toFixed(1).padStart(12)}   ${String(reducingRate.toFixed(2)).padStart(8)}   ${String(water.toFixed(1)).padStart(10)}     ${String(binder.toFixed(1)).padStart(12)}     ${cost.toFixed(2).padStart(10)}`)
      results.push({ spDosage, reducingRate, water, binder, cost })
    } catch (e) {
      console.log(`${spDosage.toFixed(1).padStart(12)}   计算失败: ${e.message}`)
    }
  }

  console.log()
  console.log('='.repeat(80))
  console.log('结论分析')
  console.log('='.repeat(80))

  if (results.length > 0) {
    const waters = results.map(r => r.water)
    const minWater = Math.min(...waters)
    const maxWater = Math.max(...waters)
    const waterVariation = maxWater - minWater

    console.log(`用水量变化范围: ${minWater.toFixed(1)} ~ ${maxWater.toFixed(1)} kg/m³`)
    console.log(`用水量变化幅度: ${waterVariation.toFixed(1)} kg/m³`)

    if (waterVariation < 1) {
      console.log('\n✗ 用水量几乎不随减水剂掺量变化 → 证实 bug C 存在')
      console.log('  减水剂基因无法影响用水量，GA 无法通过减水剂搜索到不同用水量的方案')
      console.log(`  当前用水量固定在 ${minWater.toFixed(1)} kg/m³，GA 找不到 145 kg/m³ 的方案`)
    } else {
      console.log(`\n✓ 用水量随减水剂掺量变化（变化 ${waterVariation.toFixed(1)} kg/m³）`)
      console.log('  减水剂基因能影响用水量')
      // 找最小用水量对应的掺量
      const minIdx = waters.indexOf(minWater)
      console.log(`  最低用水量 ${minWater.toFixed(1)} kg/m³ 对应减水剂掺量 ${results[minIdx].spDosage.toFixed(1)}%`)
    }

    // 看减水率变化
    const rates = results.map(r => r.reducingRate).filter(r => r >= 0)
    if (rates.length > 0) {
      const minRate = Math.min(...rates)
      const maxRate = Math.max(...rates)
      console.log(`\n减水率变化范围: ${minRate.toFixed(2)}% ~ ${maxRate.toFixed(2)}%`)
      if (maxRate - minRate < 0.5) {
        console.log('✗ 减水率几乎不随减水剂掺量变化 → 证实 bug C：减水率用的是 strengthDosage 而非基因 spDosage')
      }
    }
  }
}

main().catch(e => { console.error('分析失败:', e); process.exit(1) })
