/**
 * 验证：提高种群数和代数是否能提升GA稳定性
 * 跑3组配置，每组5次，统计适应度跨距和标准差
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

  const configs = [
    { name: '当前  50x50 ', pop: 50,  gens: 50  },
    { name: '中等 100x100', pop: 100, gens: 100 },
    { name: '大规模200x200', pop: 200, gens: 200 }
  ]

  for (const cfg of configs) {
    console.log('\n' + '='.repeat(100))
    console.log(`配置: ${cfg.name}  (种群×代数 = ${cfg.pop * cfg.gens} 评估次数)`)
    console.log('='.repeat(100))
    console.log('次数'.padEnd(6) + '水胶比'.padStart(10) + '砂率'.padStart(10) + 'SP掺量'.padStart(10) + '用水量'.padStart(10) + '胶凝材料'.padStart(10) + '强度'.padStart(10) + '成本'.padStart(10) + '适应度'.padStart(12))
    console.log('-'.repeat(98))

    const fitnesses = []
    const strengths = []
    const wbs = []
    const costs = []

    for (let i = 1; i <= 5; i++) {
      const fitness = new ConcreteFitness(snapshot, 45, 210, {})
      const fitnessWrapper = async (rawGenes) => {
        const decoded = decodeGenes(rawGenes, snapshot)
        return await fitness.evaluate(decoded)
      }
      const optimizer = new GeneticOptimizer({ populationSize: cfg.pop, generations: cfg.gens })
      const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))
      const best = result.bestSolutions[0]
      const g = best.genes

      const decoded = decodeGenes(g, snapshot)
      const r = await fitness.evaluate(decoded)
      const amounts = r.amounts || {}
      const binder = (amounts.cement || 0) + (amounts.flyAsh || 0) + (amounts.slag || 0)
        + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
      const water = amounts.water || 0

      fitnesses.push(r.fitness)
      strengths.push(r.predictions.strength28d)
      wbs.push(g.wb)
      costs.push(r.realCost)

      console.log(
        String(i).padEnd(6) +
        g.wb.toFixed(4).padStart(10) +
        g.sandRatio.toFixed(2).padStart(10) +
        g.spDosage.toFixed(2).padStart(10) +
        water.toFixed(1).padStart(10) +
        binder.toFixed(1).padStart(10) +
        r.predictions.strength28d.toFixed(2).padStart(10) +
        r.realCost.toFixed(2).padStart(10) +
        r.fitness.toFixed(2).padStart(12)
      )
    }

    // 统计
    const stat = (arr) => {
      const mean = arr.reduce((s, x) => s + x, 0) / arr.length
      const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length
      const std = Math.sqrt(variance)
      const min = Math.min(...arr)
      const max = Math.max(...arr)
      return { mean, std, min, max, range: max - min }
    }

    const fS = stat(fitnesses)
    const sS = stat(strengths)
    const wS = stat(wbs)
    const cS = stat(costs)

    console.log('-'.repeat(98))
    console.log('适应度  均值=' + fS.mean.toFixed(2) + ' 标准差=' + fS.std.toFixed(2) + ' 跨距=' + fS.range.toFixed(2) + ' (min=' + fS.min.toFixed(2) + ', max=' + fS.max.toFixed(2) + ')')
    console.log('强度    均值=' + sS.mean.toFixed(2) + ' 标准差=' + sS.std.toFixed(2) + ' 跨距=' + sS.range.toFixed(2))
    console.log('水胶比  均值=' + wS.mean.toFixed(4) + ' 标准差=' + wS.std.toFixed(4) + ' 跨距=' + wS.range.toFixed(4))
    console.log('成本    均值=' + cS.mean.toFixed(2) + ' 标准差=' + cS.std.toFixed(2) + ' 跨距=' + cS.range.toFixed(2))
  }
}

main().catch(e => console.error('错误:', e))
