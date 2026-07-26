/**
 * 跑GA拿到完整配合比，输出材料用量明细
 * 然后用相同基因（除水胶比外）跑0.60 vs 0.475对比
 */
const CandidatePoolBuilder = require('../src/main/services/CandidatePoolBuilder')
const ConcreteFitness = require('../src/main/services/ConcreteFitness')
const GeneticOptimizer = require('../src/main/services/GeneticOptimizer')
const MaterialService = require('../src/main/services/MaterialService')

async function main() {
  console.log('='.repeat(80))
  console.log('跑GA拿到完整配合比 + 对比0.475 vs 0.60')
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

  // 跑GA
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
      wb: rawGenes.wb,
      sandRatio: rawGenes.sandRatio,
      spDosage: rawGenes.spDosage,
      flyAshDosage: rawGenes.flyAshDosage ?? 0,
      slagDosage: rawGenes.slagDosage ?? 0,
      lithiumSlagDosage: rawGenes.lithiumSlagDosage ?? 0,
      compositePowderDosage: rawGenes.compositePowderDosage ?? 0,
      sand2Proportion: rawGenes.sand2Proportion ?? 0,
      stone2Proportion: rawGenes.stone2Proportion ?? 0
    }
  }

  const fitnessWrapper = async (rawGenes) => {
    const decoded = decodeGenes(rawGenes, snapshot)
    return await fitness.evaluate(decoded)
  }

  console.log('跑GA（种群50，迭代50）...')
  const optimizer = new GeneticOptimizer({ populationSize: 50, generations: 50 })
  const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))

  if (!result.bestSolutions || result.bestSolutions.length === 0) {
    console.log('GA未找到有效方案')
    return
  }

  const best = result.bestSolutions[0]
  const g = best.genes
  console.log()
  console.log('=== GA最优方案（水胶比0.475，强度64.77）===')
  console.log(`水胶比: ${g.wb.toFixed(3)}`)
  console.log(`砂率: ${g.sandRatio.toFixed(2)}%`)
  console.log(`减水剂掺量: ${g.spDosage.toFixed(2)}%`)
  console.log(`粉煤灰掺量: ${(g.flyAshDosage ?? 0).toFixed(1)}%`)
  console.log(`矿渣掺量: ${(g.slagDosage ?? 0).toFixed(1)}%`)
  console.log(`锂渣掺量: ${(g.lithiumSlagDosage ?? 0).toFixed(1)}%`)
  console.log(`复合粉掺量: ${(g.compositePowderDosage ?? 0).toFixed(1)}%`)
  console.log(`砂1索引: ${g.sand1Gene}，砂2索引: ${g.sand2Gene}，砂2比例: ${(g.sand2Proportion ?? 0).toFixed(1)}%`)
  console.log(`石1索引: ${g.stone1Gene}，石2索引: ${g.stone2Gene}，石2比例: ${(g.stone2Proportion ?? 0).toFixed(1)}%`)
  console.log(`预测强度: ${best.predictions?.strength28d?.toFixed(2)} MPa`)
  console.log(`适应度: ${best.fitness?.toFixed(2)}`)
  console.log(`真实成本: ${best.realCost?.toFixed(2)} 元/m³`)

  // 输出材料用量
  console.log()
  console.log('=== 材料用量明细（GA方案）===')
  const materials = best.materials || []
  if (materials.length > 0) {
    console.log('类型'.padEnd(15) + '材料ID'.padStart(8) + '用量(kg)'.padStart(12) + '密度'.padStart(10))
    materials.forEach(m => {
      console.log(`${m.type.padEnd(15)}${String(m.materialId).padStart(8)}${m.mass.toFixed(2).padStart(12)}${(m.density || 0).toFixed(0).padStart(10)}`)
    })
  }

  // 用相同基因，但水胶比改成0.60，重新评估
  console.log()
  console.log('='.repeat(80))
  console.log('=== 对比：相同基因，水胶比0.475 vs 0.60 ===')
  console.log('='.repeat(80))

  const decodedBest = decodeGenes(g, snapshot)

  // 方案A：原始GA方案（水胶比0.475）
  const resultA = await fitness.evaluate(decodedBest)

  // 方案B：相同基因，水胶比改0.60
  const decodedB = { ...decodedBest, wb: 0.60 }
  const resultB = await fitness.evaluate(decodedB)

  console.log()
  console.log('指标'.padEnd(20) + '方案A(0.475)'.padStart(15) + '方案B(0.60)'.padStart(15) + '差距'.padStart(15))
  console.log('-'.repeat(65))
  console.log('水胶比'.padEnd(20) + '0.475'.padStart(15) + '0.600'.padStart(15) + '+0.125'.padStart(15))
  console.log('预测强度(MPa)'.padEnd(20) + resultA.predictions.strength28d.toFixed(2).padStart(15) + resultB.predictions.strength28d.toFixed(2).padStart(15) + (resultB.predictions.strength28d - resultA.predictions.strength28d).toFixed(2).padStart(15))
  console.log('真实成本(元/m³)'.padEnd(20) + resultA.realCost.toFixed(2).padStart(15) + resultB.realCost.toFixed(2).padStart(15) + (resultB.realCost - resultA.realCost).toFixed(2).padStart(15))
  console.log('砂率罚分'.padEnd(20) + (resultA.sandRatioPenalty || 0).toFixed(2).padStart(15) + (resultB.sandRatioPenalty || 0).toFixed(2).padStart(15) + ((resultB.sandRatioPenalty || 0) - (resultA.sandRatioPenalty || 0)).toFixed(2).padStart(15))
  console.log('适应度'.padEnd(20) + resultA.fitness.toFixed(2).padStart(15) + resultB.fitness.toFixed(2).padStart(15) + (resultB.fitness - resultA.fitness).toFixed(2).padStart(15))

  // 输出方案B的材料用量
  console.log()
  console.log('=== 方案B（水胶比0.60）材料用量明细 ===')
  const materialsB = resultB.materials || []
  if (materialsB.length > 0) {
    console.log('类型'.padEnd(15) + '材料ID'.padStart(8) + '用量(kg)'.padStart(12) + '密度'.padStart(10))
    materialsB.forEach(m => {
      console.log(`${m.type.padEnd(15)}${String(m.materialId).padStart(8)}${m.mass.toFixed(2).padStart(12)}${(m.density || 0).toFixed(0).padStart(10)}`)
    })
  }
}

main().catch(e => console.error('错误:', e))
