/**
 * 测算：基于GA的0.475方案
 * - 原方案：用水量142.8，胶凝材料300.6，水胶比0.475
 * - 新方案：用水量+10=152.8，胶凝材料保持300.6，水胶比=152.8/300.6=0.508
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

  // 跑GA拿基准基因（用水量142.8，胶凝材料300.6，水胶比0.475）
  const optimizer = new GeneticOptimizer({ populationSize: 50, generations: 50 })
  const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))
  const best = result.bestSolutions[0]
  const g = best.genes

  console.log('='.repeat(80))
  console.log('GA最优方案（基准）')
  console.log('='.repeat(80))

  // 评估基准方案
  const baseDecoded = decodeGenes(g, snapshot)
  const baseResult = await fitness.evaluate(baseDecoded)
  const baseAmounts = baseResult.amounts || {}
  const baseBinder = (baseAmounts.cement || 0) + (baseAmounts.flyAsh || 0) + (baseAmounts.slag || 0)
    + (baseAmounts.lithiumSlag || 0) + (baseAmounts.compositePowder || 0)
  const baseWater = baseAmounts.water || 0

  console.log(`水胶比（基因）: ${g.wb.toFixed(4)}`)
  console.log(`用水量: ${baseWater.toFixed(1)} kg/m³`)
  console.log(`胶凝材料: ${baseBinder.toFixed(1)} kg/m³`)
  console.log(`实际水胶比: ${(baseWater/baseBinder).toFixed(4)}`)
  console.log(`预测强度: ${baseResult.predictions.strength28d.toFixed(2)} MPa`)
  console.log(`真实成本: ${baseResult.realCost.toFixed(2)} 元/m³`)
  console.log(`减水剂掺量: ${g.spDosage.toFixed(2)}%`)
  console.log(`砂率: ${g.sandRatio.toFixed(2)}%`)
  console.log(`粉煤灰/矿渣/锂渣/复合粉: ${(g.flyAshDosage||0).toFixed(1)}/${(g.slagDosage||0).toFixed(1)}/${(g.lithiumSlagDosage||0).toFixed(1)}/${(g.compositePowderDosage||0).toFixed(1)}%`)

  // 新方案：用水量+10kg，胶凝材料保持不变
  // 新水胶比 = (原用水量+10) / 原胶凝材料
  const newWater = baseWater + 10
  const newWb = newWater / baseBinder

  console.log()
  console.log('='.repeat(80))
  console.log('新方案：用水量+10kg，胶凝材料保持不变')
  console.log('='.repeat(80))
  console.log(`新用水量: ${newWater.toFixed(1)} kg/m³（原${baseWater.toFixed(1)}+10）`)
  console.log(`胶凝材料: ${baseBinder.toFixed(1)} kg/m³（保持不变）`)
  console.log(`新水胶比: ${newWb.toFixed(4)}（原${g.wb.toFixed(4)}）`)

  // 用新水胶比评估
  const newDecoded = decodeGenes({ ...g, wb: newWb }, snapshot)
  const newResult = await fitness.evaluate(newDecoded)
  const newAmounts = newResult.amounts || {}
  const newBinderActual = (newAmounts.cement || 0) + (newAmounts.flyAsh || 0) + (newAmounts.slag || 0)
    + (newAmounts.lithiumSlag || 0) + (newAmounts.compositePowder || 0)
  const newWaterActual = newAmounts.water || 0
  const isRejected = newResult.fitness > 1e100

  console.log()
  console.log('=== 新方案评估结果 ===')
  console.log(`实际用水量: ${newWaterActual.toFixed(1)} kg/m³`)
  console.log(`实际胶凝材料: ${newBinderActual.toFixed(1)} kg/m³`)
  console.log(`实际水胶比: ${(newWaterActual/newBinderActual).toFixed(4)}`)
  console.log(`预测强度: ${newResult.predictions.strength28d.toFixed(2)} MPa`)
  console.log(`真实成本: ${newResult.realCost.toFixed(2)} 元/m³`)
  console.log(`状态: ${isRejected ? '淘汰（' + (newResult.rejectReason || '原因不明') + '）' : '可行'}`)

  // 对比
  console.log()
  console.log('='.repeat(80))
  console.log('=== 对比 ===')
  console.log('='.repeat(80))
  console.log('指标'.padEnd(20) + '原方案'.padStart(15) + '新方案'.padStart(15) + '差距'.padStart(15))
  console.log('-'.repeat(65))
  console.log('用水量(kg/m³)'.padEnd(20) + baseWater.toFixed(1).padStart(15) + newWaterActual.toFixed(1).padStart(15) + (newWaterActual-baseWater).toFixed(1).padStart(15))
  console.log('胶凝材料(kg/m³)'.padEnd(20) + baseBinder.toFixed(1).padStart(15) + newBinderActual.toFixed(1).padStart(15) + (newBinderActual-baseBinder).toFixed(1).padStart(15))
  console.log('水胶比'.padEnd(20) + g.wb.toFixed(4).padStart(15) + newWb.toFixed(4).padStart(15) + (newWb-g.wb).toFixed(4).padStart(15))
  console.log('预测强度(MPa)'.padEnd(20) + baseResult.predictions.strength28d.toFixed(2).padStart(15) + newResult.predictions.strength28d.toFixed(2).padStart(15) + (newResult.predictions.strength28d-baseResult.predictions.strength28d).toFixed(2).padStart(15))
  console.log('真实成本(元/m³)'.padEnd(20) + baseResult.realCost.toFixed(2).padStart(15) + newResult.realCost.toFixed(2).padStart(15) + (newResult.realCost-baseResult.realCost).toFixed(2).padStart(15))
  console.log('富余强度(MPa)'.padEnd(20) + (baseResult.predictions.strength28d-45).toFixed(2).padStart(15) + (newResult.predictions.strength28d-45).toFixed(2).padStart(15) + ((newResult.predictions.strength28d-45)-(baseResult.predictions.strength28d-45)).toFixed(2).padStart(15))
}

main().catch(e => console.error('错误:', e))
