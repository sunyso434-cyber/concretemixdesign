/**
 * 扫描不同水胶比，找到满足所有约束的最低成本解
 * 验证GA找到的0.483是否真的是成本最低
 */
const CandidatePoolBuilder = require('../src/main/services/CandidatePoolBuilder')
const ConcreteFitness = require('../src/main/services/ConcreteFitness')
const GeneticOptimizer = require('../src/main/services/GeneticOptimizer')
const MaterialService = require('../src/main/services/MaterialService')

async function main() {
  console.log('='.repeat(80))
  console.log('扫描水胶比，找满足所有约束的最低成本解')
  console.log('='.repeat(80))

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

  // 先跑GA拿一套基准基因
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

  console.log('跑GA拿基准基因...')
  const optimizer = new GeneticOptimizer({ populationSize: 50, generations: 50 })
  const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))
  const best = result.bestSolutions[0]
  const g = best.genes

  console.log(`GA最优: 水胶比=${g.wb.toFixed(3)}, 成本=${best.realCost.toFixed(2)}, 强度=${best.predictions.strength28d.toFixed(2)}`)
  console.log()

  // 用GA的基因，扫描水胶比0.30~0.60
  console.log('=== 扫描水胶比（用GA的其他基因）===')
  console.log('水胶比'.padStart(8) + '强度'.padStart(10) + '成本'.padStart(12) + '砂率罚分'.padStart(10) + '适应度'.padStart(12) + '状态'.padStart(10))
  console.log('-'.repeat(62))

  const results = []
  for (let wb = 0.30; wb <= 0.61; wb += 0.025) {
    const decoded = decodeGenes({ ...g, wb }, snapshot)
    const r = await fitness.evaluate(decoded)
    const isRejected = r.fitness > 1e100
    const sandRatioPenalty = r.sandRatioPenalty || 0
    const status = isRejected ? (r.rejectReason || '淘汰') : '可行'
    console.log(
      wb.toFixed(3).padStart(8) +
      r.predictions.strength28d.toFixed(2).padStart(10) +
      r.realCost.toFixed(2).padStart(12) +
      sandRatioPenalty.toFixed(2).padStart(10) +
      (isRejected ? 'MAX' : r.fitness.toFixed(2)).padStart(12) +
      status.padStart(10)
    )
    results.push({ wb, cost: r.realCost, strength: r.predictions.strength28d, isRejected, fitness: r.fitness })
  }

  // 找出可行解中成本最低的
  console.log()
  const feasible = results.filter(r => !r.isRejected)
  if (feasible.length > 0) {
    const minCost = feasible.reduce((min, r) => r.cost < min.cost ? r : min, feasible[0])
    console.log('='.repeat(80))
    console.log('=== 结论 ===')
    console.log('='.repeat(80))
    console.log(`GA找到的解: 水胶比=${g.wb.toFixed(3)}, 成本=${best.realCost.toFixed(2)}, 强度=${best.predictions.strength28d.toFixed(2)}`)
    console.log(`扫描最低成本: 水胶比=${minCost.wb.toFixed(3)}, 成本=${minCost.cost.toFixed(2)}, 强度=${minCost.strength.toFixed(2)}`)
    console.log(`差距: ${minCost.cost - best.realCost > 0 ? '+' : ''}${(minCost.cost - best.realCost).toFixed(2)} 元/m³`)
    if (minCost.cost < best.realCost - 1) {
      console.log(`>>> GA找到的解不是成本最低！理论上还能降 ${(best.realCost - minCost.cost).toFixed(2)} 元/m³`)
    } else if (Math.abs(minCost.cost - best.realCost) <= 1) {
      console.log(`>>> GA找到的解接近成本最低（差距≤1元）`)
    } else {
      console.log(`>>> GA找到的解比扫描最低成本高 ${(best.realCost - minCost.cost).toFixed(2)} 元/m³`)
    }
  }
}

main().catch(e => console.error('错误:', e))
