/**
 * 扫描减水剂掺量，看用水量和强度的变化
 * 验证：降低减水剂掺量 -> 降低减水率 -> 提高用水量 -> 降低强度
 */
const CandidatePoolBuilder = require('../src/main/services/CandidatePoolBuilder')
const ConcreteFitness = require('../src/main/services/ConcreteFitness')
const GeneticOptimizer = require('../src/main/services/GeneticOptimizer')
const MaterialService = require('../src/main/services/MaterialService')

async function main() {
  const allMaterials = await MaterialService.getAllMaterials()
  const sands = allMaterials.filter(m => m.type === '细骨料').slice(0, 3)
  const stones = allMaterials.filter(m => m.type === '粗骨料').slice(0, 3)
  const materialIds = {
    cementIds: [allMaterials.find(m => m.type === '水泥').id],
    sandIds: sands.map(m => m.id),
    stoneIds: stones.map(m => m.id),
    spIds: [allMaterials.find(m => m.type === '减水剂').id],
    waterIds: [allMaterials.find(m => m.type === '其他' || m.type === '水').id],
    flyAshIds: [], slagIds: [], lithiumSlagIds: [], compositePowderIds: []
  }
  const snapshot = await CandidatePoolBuilder.buildSnapshot(materialIds)
  const fitness = new ConcreteFitness(snapshot, 45, 210, {})

  function buildGeneSpec(snap) {
    const spec = { continuous: [], discrete: [] }
    spec.continuous.push({ name: 'wb', min: 0.30, max: 0.60 })
    spec.discrete.push({ name: 'cementGene', candidates: Array.from({ length: snap.candidatePools.cement.length }, (_, i) => i) })
    spec.continuous.push({ name: 'sandRatio', min: 30, max: 55 })
    spec.discrete.push({ name: 'sand1Gene', candidates: Array.from({ length: snap.candidatePools.sand.length }, (_, i) => i) })
    if (snap.candidatePools.sand.length > 1) {
      spec.discrete.push({ name: 'sand2Gene', candidates: Array.from({ length: snap.candidatePools.sand.length }, (_, i) => i) })
      spec.continuous.push({ name: 'sand2Proportion', min: 0, max: 100 })
    }
    spec.discrete.push({ name: 'stone1Gene', candidates: Array.from({ length: snap.candidatePools.stone.length }, (_, i) => i) })
    if (snap.candidatePools.stone.length > 1) {
      spec.discrete.push({ name: 'stone2Gene', candidates: Array.from({ length: snap.candidatePools.stone.length }, (_, i) => i) })
      spec.continuous.push({ name: 'stone2Proportion', min: 0, max: 100 })
    }
    spec.discrete.push({ name: 'spGene', candidates: Array.from({ length: snap.candidatePools.sp.length }, (_, i) => i) })
    spec.continuous.push({ name: 'spDosage', min: 1.0, max: 5.0 })
    spec.continuous.push({ name: 'flyAshDosage', min: 0, max: 30 })
    spec.continuous.push({ name: 'slagDosage', min: 0, max: 30 })
    spec.continuous.push({ name: 'lithiumSlagDosage', min: 0, max: 30 })
    spec.continuous.push({ name: 'compositePowderDosage', min: 0, max: 30 })
    return spec
  }

  function decodeGenes(rawGenes, snap) {
    const sand = rawGenes.sand2Gene !== undefined
      ? [snap.candidatePools.sand[rawGenes.sand1Gene], snap.candidatePools.sand[rawGenes.sand2Gene]]
      : snap.candidatePools.sand[rawGenes.sand1Gene]
    const stone = rawGenes.stone2Gene !== undefined
      ? [snap.candidatePools.stone[rawGenes.stone1Gene], snap.candidatePools.stone[rawGenes.stone2Gene]]
      : snap.candidatePools.stone[rawGenes.stone1Gene]
    return {
      cement: snap.candidatePools.cement[rawGenes.cementGene],
      sand, stone,
      sp: snap.candidatePools.sp[rawGenes.spGene],
      water: snap.candidatePools.water[0],
      wb: rawGenes.wb, sandRatio: rawGenes.sandRatio, spDosage: rawGenes.spDosage,
      flyAshDosage: rawGenes.flyAshDosage ?? 0, slagDosage: rawGenes.slagDosage ?? 0,
      lithiumSlagDosage: rawGenes.lithiumSlagDosage ?? 0, compositePowderDosage: rawGenes.compositePowderDosage ?? 0,
      sand2Proportion: rawGenes.sand2Proportion ?? 0, stone2Proportion: rawGenes.stone2Proportion ?? 0
    }
  }

  const fitnessWrapper = async (rawGenes) => {
    const decoded = decodeGenes(rawGenes, snapshot)
    return await fitness.evaluate(decoded)
  }

  // 跑GA拿基准基因
  const optimizer = new GeneticOptimizer({ populationSize: 50, generations: 50 })
  const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))
  const best = result.bestSolutions[0]
  const g = best.genes

  console.log('='.repeat(80))
  console.log('GA最优: spDosage=' + g.spDosage.toFixed(3) + ', wb=' + g.wb.toFixed(4) + ', 成本=' + best.realCost.toFixed(2) + ', 强度=' + best.predictions.strength28d.toFixed(2))
  console.log('='.repeat(80))

  // 扫描减水剂掺量1.0~3.0，水胶比保持GA的值
  console.log()
  console.log('=== 扫描减水剂掺量（水胶比固定=' + g.wb.toFixed(3) + '）===')
  console.log('SP掺量'.padStart(8) + '减水率'.padStart(10) + '用水量'.padStart(10) + '胶凝材料'.padStart(10) + '实际W/B'.padStart(10) + '强度'.padStart(10) + '成本'.padStart(10) + '状态'.padStart(8))
  console.log('-'.repeat(76))

  const results = []
  for (let spDosage = 1.0; spDosage <= 3.0; spDosage += 0.1) {
    // 水胶比固定，但用水量会随减水率变化，胶凝材料=用水量/水胶比
    // 这里我们让模型自己算
    const decoded = decodeGenes({ ...g, spDosage }, snapshot)
    const r = await fitness.evaluate(decoded)
    const isRejected = r.fitness > 1e100
    const amounts = r.amounts || {}
    const binderTotal = (amounts.cement || 0) + (amounts.flyAsh || 0) + (amounts.slag || 0)
      + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
    const waterMass = amounts.water || 0
    const actualWb = binderTotal > 0 ? waterMass / binderTotal : 0

    // 减水率反推
    const reducingRate = waterMass > 0 ? (1 - waterMass / 230) * 100 : 0

    console.log(
      spDosage.toFixed(2).padStart(8) +
      reducingRate.toFixed(2).padStart(10) +
      waterMass.toFixed(1).padStart(10) +
      binderTotal.toFixed(1).padStart(10) +
      actualWb.toFixed(3).padStart(10) +
      r.predictions.strength28d.toFixed(2).padStart(10) +
      r.realCost.toFixed(2).padStart(10) +
      (isRejected ? '淘汰' : '可行').padStart(8)
    )
    results.push({ spDosage, water: waterMass, binder: binderTotal, strength: r.predictions.strength28d, cost: r.realCost, isRejected, actualWb })
  }

  // 分析
  console.log()
  console.log('='.repeat(80))
  console.log('=== 分析 ===')
  console.log('='.repeat(80))

  const feasible = results.filter(r => !r.isRejected)
  if (feasible.length > 0) {
    // 找强度最接近45+5=50的
    const targetStrength = 50
    const closestToTarget = feasible.reduce((best, r) =>
      Math.abs(r.strength - targetStrength) < Math.abs(best.strength - targetStrength) ? r : best, feasible[0])
    console.log(`目标强度 ${targetStrength} MPa 附近的解:`)
    console.log(`  SP掺量: ${closestToTarget.spDosage.toFixed(2)}%`)
    console.log(`  用水量: ${closestToTarget.water.toFixed(1)} kg/m³`)
    console.log(`  胶凝材料: ${closestToTarget.binder.toFixed(1)} kg/m³`)
    console.log(`  实际水胶比: ${closestToTarget.actualWb.toFixed(3)}`)
    console.log(`  预测强度: ${closestToTarget.strength.toFixed(2)} MPa`)
    console.log(`  成本: ${closestToTarget.cost.toFixed(2)} 元/m³`)

    // 找成本最低的
    const minCost = feasible.reduce((min, r) => r.cost < min.cost ? r : min, feasible[0])
    console.log()
    console.log(`成本最低的解:`)
    console.log(`  SP掺量: ${minCost.spDosage.toFixed(2)}%`)
    console.log(`  用水量: ${minCost.water.toFixed(1)} kg/m³`)
    console.log(`  胶凝材料: ${minCost.binder.toFixed(1)} kg/m³`)
    console.log(`  实际水胶比: ${minCost.actualWb.toFixed(3)}`)
    console.log(`  预测强度: ${minCost.strength.toFixed(2)} MPa`)
    console.log(`  成本: ${minCost.cost.toFixed(2)} 元/m³`)
  }
}

main().catch(e => console.error('错误:', e))
