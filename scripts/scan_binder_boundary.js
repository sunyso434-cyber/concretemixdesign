/**
 * 精确扫描：找胶凝材料=300对应的水胶比
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

  // 跑GA拿基准
  const optimizer = new GeneticOptimizer({ populationSize: 50, generations: 50 })
  const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))
  const best = result.bestSolutions[0]
  const g = best.genes

  console.log('='.repeat(80))
  console.log('GA最优方案: 水胶比=' + g.wb.toFixed(4) + ', 成本=' + best.realCost.toFixed(2) + ', 强度=' + best.predictions.strength28d.toFixed(2))
  console.log('='.repeat(80))

  // 精确扫描水胶比0.475~0.510，步长0.001，输出胶凝材料
  console.log()
  console.log('=== 精确扫描：水胶比 vs 胶凝材料 vs 成本 vs 强度 ===')
  console.log('水胶比'.padStart(8) + '胶凝材料'.padStart(10) + '成本'.padStart(10) + '强度'.padStart(10) + '用水量'.padStart(10) + '状态'.padStart(8))
  console.log('-'.repeat(56))

  const results = []
  for (let wb = 0.475; wb <= 0.510; wb += 0.001) {
    const decoded = decodeGenes({ ...g, wb }, snapshot)
    const r = await fitness.evaluate(decoded)
    const isRejected = r.fitness > 1e100

    // 从amounts直接读胶凝材料和用水量
    const amounts = r.amounts || {}
    const binderTotal = (amounts.cement || 0) + (amounts.flyAsh || 0) + (amounts.slag || 0)
      + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
    const waterMass = amounts.water || 0

    const status = isRejected ? '淘汰' : '可行'
    console.log(
      wb.toFixed(3).padStart(8) +
      binderTotal.toFixed(1).padStart(10) +
      r.realCost.toFixed(2).padStart(10) +
      r.predictions.strength28d.toFixed(2).padStart(10) +
      waterMass.toFixed(1).padStart(10) +
      status.padStart(8)
    )
    results.push({ wb, binder: binderTotal, cost: r.realCost, strength: r.predictions.strength28d, water: waterMass, isRejected })
  }

  // 找胶凝材料=300的水胶比
  console.log()
  console.log('='.repeat(80))
  console.log('=== 关键问题回答 ===')
  console.log('='.repeat(80))

  // 1. GA水胶比0.485对应的胶凝材料
  const gaResult = results.find(r => Math.abs(r.wb - 0.485) < 0.001) || results.find(r => Math.abs(r.wb - g.wb) < 0.002)
  if (gaResult) {
    console.log(`1. GA水胶比 ${g.wb.toFixed(4)} 对应的胶凝材料: ${gaResult.binder.toFixed(1)} kg/m³`)
  }

  // 2. 胶凝材料=300对应的水胶比（在可行解里找）
  const feasibleResults = results.filter(r => !r.isRejected)
  // 找最接近300的
  let closestTo300 = null
  feasibleResults.forEach(r => {
    if (!closestTo300 || Math.abs(r.binder - 300) < Math.abs(closestTo300.binder - 300)) {
      closestTo300 = r
    }
  })
  if (closestTo300) {
    console.log(`2. 胶凝材料 ${closestTo300.binder.toFixed(1)} kg/m³（最接近300）对应:`)
    console.log(`   水胶比: ${closestTo300.wb.toFixed(3)}`)
    console.log(`   预测强度: ${closestTo300.strength.toFixed(2)} MPa`)
    console.log(`   成本: ${closestTo300.cost.toFixed(2)} 元/m³`)
    console.log(`   用水量: ${closestTo300.water.toFixed(1)} kg/m³`)
  }

  // 找胶凝材料=300的精确分界点（最后一个可行解）
  const lastFeasible = feasibleResults[feasibleResults.length - 1]
  const firstRejected = results.find(r => r.isRejected)
  if (lastFeasible && firstRejected) {
    console.log()
    console.log(`=== 可行/淘汰分界点 ===`)
    console.log(`最后一个可行解: 水胶比 ${lastFeasible.wb.toFixed(3)}, 胶凝材料 ${lastFeasible.binder.toFixed(1)}, 成本 ${lastFeasible.cost.toFixed(2)}, 强度 ${lastFeasible.strength.toFixed(2)}`)
    console.log(`第一个淘汰解: 水胶比 ${firstRejected.wb.toFixed(3)}, 胶凝材料 ${firstRejected.binder.toFixed(1)}, 成本 ${firstRejected.cost.toFixed(2)}, 强度 ${firstRejected.strength.toFixed(2)}`)
  }
}

main().catch(e => console.error('错误:', e))
