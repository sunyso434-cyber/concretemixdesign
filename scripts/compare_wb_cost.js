/**
 * 对比水胶比 0.60 vs 0.475 的真实成本
 */
const path = require('path')
const CandidatePoolBuilder = require('../src/main/services/CandidatePoolBuilder')
const ConcreteFitness = require('../src/main/services/ConcreteFitness')
const MaterialService = require('../src/main/services/MaterialService')

async function main() {
  console.log('='.repeat(80))
  console.log('对比水胶比 0.60 vs 0.475 的真实成本和适应度')
  console.log('='.repeat(80))

  const allMaterials = await MaterialService.getAllMaterials()
  const materialIds = {
    cementIds: [allMaterials.find(m => m.type === '水泥').id],
    sandIds: [allMaterials.filter(m => m.type === '细骨料')[2].id],
    stoneIds: [allMaterials.filter(m => m.type === '粗骨料')[2].id],
    spIds: [allMaterials.find(m => m.type === '减水剂').id],
    waterIds: [allMaterials.find(m => m.type === '其他' || m.type === '水').id],
    flyAshIds: [], slagIds: [], lithiumSlagIds: [], compositePowderIds: []
  }
  const snapshot = await CandidatePoolBuilder.buildSnapshot(materialIds)
  const fitness = new ConcreteFitness(snapshot, 45, 210, {})

  // 构造两个对比方案
  const sand = snapshot.candidatePools.sand[0]
  const stone = snapshot.candidatePools.stone[0]
  const cement = snapshot.candidatePools.cement[0]
  const sp = snapshot.candidatePools.sp[0]
  const water = snapshot.candidatePools.water[0]

  const scenarios = [
    { name: 'A. 水胶比 0.60（之前）', wb: 0.60, sandRatio: 40.24, spDosage: 1.56 },
    { name: 'B. 水胶比 0.475（现在）', wb: 0.475, sandRatio: 32.18, spDosage: 2.39 },
    { name: 'C. 水胶比 0.60 + 砂率 32%（假设）', wb: 0.60, sandRatio: 32.0, spDosage: 2.39 },
    { name: 'D. 水胶比 0.475 + 砂率 40%（假设）', wb: 0.475, sandRatio: 40.0, spDosage: 1.56 }
  ]

  console.log()
  console.log('场景'.padEnd(40) + '真实成本'.padStart(10) + '强度'.padStart(10) + '砂率罚分'.padStart(10) + '适应度'.padStart(10))
  console.log('-'.repeat(80))

  for (const s of scenarios) {
    const genes = {
      wb: s.wb, sandRatio: s.sandRatio, spDosage: s.spDosage,
      cement, sand, stone, sp, water,
      flyAshDosage: 17, slagDosage: 0, lithiumSlagDosage: 17, compositePowderDosage: 30,
      sand2Proportion: 0, stone2Proportion: 0
    }
    try {
      const result = await fitness.evaluate(genes)
      const sandRatioPenalty = result.sandRatioPenalty || 0
      console.log(
        s.name.padEnd(40) +
        result.realCost.toFixed(2).padStart(10) +
        (result.predictions?.strength28d || 0).toFixed(2).padStart(10) +
        sandRatioPenalty.toFixed(2).padStart(10) +
        result.fitness.toFixed(2).padStart(10)
      )
    } catch (e) {
      console.log(s.name.padEnd(40) + '评估失败: ' + e.message)
    }
  }

  console.log()
  console.log('='.repeat(80))
  console.log('分析')
  console.log('='.repeat(80))
}

main().catch(e => console.error('错误:', e))
