/**
 * 直接计算：用水量=152.8，胶凝材料=300.6，水胶比=152.8/300.6=0.5073
 * 用GA的其他基因，预测强度和成本
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

  // 关键：用 ConcreteFitness 但绕过胶凝材料下限约束（设binderMin=0）
  const fitness = new ConcreteFitness(snapshot, 45, 210, { binderMin: 0 })

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
  console.log('GA基准方案')
  console.log('='.repeat(80))
  const baseDecoded = decodeGenes(g, snapshot)
  const baseResult = await fitness.evaluate(baseDecoded)
  const baseAmounts = baseResult.amounts || {}
  const baseBinder = (baseAmounts.cement || 0) + (baseAmounts.flyAsh || 0) + (baseAmounts.slag || 0)
    + (baseAmounts.lithiumSlag || 0) + (baseAmounts.compositePowder || 0)
  const baseWater = baseAmounts.water || 0

  console.log(`水胶比: ${g.wb.toFixed(4)}`)
  console.log(`用水量: ${baseWater.toFixed(1)} kg/m³`)
  console.log(`胶凝材料: ${baseBinder.toFixed(1)} kg/m³`)
  console.log(`预测强度: ${baseResult.predictions.strength28d.toFixed(2)} MPa`)
  console.log(`真实成本: ${baseResult.realCost.toFixed(2)} 元/m³`)

  // 目标方案：用水量152.8，胶凝材料300.6
  // 水胶比 = 152.8 / 300.6 = 0.5083
  const targetWater = 152.8
  const targetBinder = 300.6
  const targetWb = targetWater / targetBinder

  console.log()
  console.log('='.repeat(80))
  console.log(`目标方案：用水量=${targetWater}, 胶凝材料=${targetBinder}, 水胶比=${targetWb.toFixed(4)}`)
  console.log('='.repeat(80))

  // 用目标水胶比评估
  const targetDecoded = decodeGenes({ ...g, wb: targetWb }, snapshot)
  const targetResult = await fitness.evaluate(targetDecoded)
  const targetAmounts = targetResult.amounts || {}
  const targetBinderActual = (targetAmounts.cement || 0) + (targetAmounts.flyAsh || 0) + (targetAmounts.slag || 0)
    + (targetAmounts.lithiumSlag || 0) + (targetAmounts.compositePowder || 0)
  const targetWaterActual = targetAmounts.water || 0
  const isRejected = targetResult.fitness > 1e100

  console.log(`实际用水量: ${targetWaterActual.toFixed(2)} kg/m³`)
  console.log(`实际胶凝材料: ${targetBinderActual.toFixed(2)} kg/m³`)
  console.log(`实际水胶比: ${targetBinderActual > 0 ? (targetWaterActual/targetBinderActual).toFixed(4) : 'N/A'}`)
  console.log(`预测强度: ${targetResult.predictions.strength28d.toFixed(2)} MPa`)
  console.log(`真实成本: ${targetResult.realCost.toFixed(2)} 元/m³`)
  console.log(`状态: ${isRejected ? '淘汰（' + (targetResult.rejectReason || '原因不明') + '）' : '可行'}`)

  // 材料明细
  console.log()
  console.log('=== 材料用量明细 ===')
  console.log('材料'.padEnd(15) + '用量(kg)'.padStart(12))
  console.log('-'.repeat(27))
  console.log(`水泥`.padEnd(15) + (targetAmounts.cement || 0).toFixed(2).padStart(12))
  console.log(`水`.padEnd(15) + (targetAmounts.water || 0).toFixed(2).padStart(12))
  console.log(`粉煤灰`.padEnd(15) + (targetAmounts.flyAsh || 0).toFixed(2).padStart(12))
  console.log(`矿渣`.padEnd(15) + (targetAmounts.slag || 0).toFixed(2).padStart(12))
  console.log(`锂渣`.padEnd(15) + (targetAmounts.lithiumSlag || 0).toFixed(2).padStart(12))
  console.log(`复合粉`.padEnd(15) + (targetAmounts.compositePowder || 0).toFixed(2).padStart(12))
  console.log(`砂`.padEnd(15) + ((targetAmounts.sand || 0) + (targetAmounts.sand2 || 0)).toFixed(2).padStart(12))
  console.log(`石`.padEnd(15) + ((targetAmounts.stone || 0) + (targetAmounts.stone2 || 0)).toFixed(2).padStart(12))
  console.log(`减水剂`.padEnd(15) + (targetAmounts.superplasticizer || 0).toFixed(2).padStart(12))

  // 对比
  console.log()
  console.log('='.repeat(80))
  console.log('=== 对比 ===')
  console.log('='.repeat(80))
  console.log('指标'.padEnd(20) + 'GA基准'.padStart(15) + '目标方案'.padStart(15) + '差距'.padStart(15))
  console.log('-'.repeat(65))
  console.log('用水量(kg/m³)'.padEnd(20) + baseWater.toFixed(1).padStart(15) + targetWaterActual.toFixed(1).padStart(15) + (targetWaterActual-baseWater).toFixed(1).padStart(15))
  console.log('胶凝材料(kg/m³)'.padEnd(20) + baseBinder.toFixed(1).padStart(15) + targetBinderActual.toFixed(1).padStart(15) + (targetBinderActual-baseBinder).toFixed(1).padStart(15))
  console.log('水胶比'.padEnd(20) + g.wb.toFixed(4).padStart(15) + targetWb.toFixed(4).padStart(15) + (targetWb-g.wb).toFixed(4).padStart(15))
  console.log('预测强度(MPa)'.padEnd(20) + baseResult.predictions.strength28d.toFixed(2).padStart(15) + targetResult.predictions.strength28d.toFixed(2).padStart(15) + (targetResult.predictions.strength28d-baseResult.predictions.strength28d).toFixed(2).padStart(15))
  console.log('真实成本(元/m³)'.padEnd(20) + baseResult.realCost.toFixed(2).padStart(15) + targetResult.realCost.toFixed(2).padStart(15) + (targetResult.realCost-baseResult.realCost).toFixed(2).padStart(15))
  console.log('富余强度(MPa)'.padEnd(20) + (baseResult.predictions.strength28d-45).toFixed(2).padStart(15) + (targetResult.predictions.strength28d-45).toFixed(2).padStart(15) + ((targetResult.predictions.strength28d-45)-(baseResult.predictions.strength28d-45)).toFixed(2).padStart(15))
}

main().catch(e => console.error('错误:', e))
