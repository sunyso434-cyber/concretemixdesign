/**
 * 适应度地形陡度分析
 * 跑10次GA，识别等价解对，诊断平坦方向
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

  const N = 10
  console.log('='.repeat(110))
  console.log(`跑 ${N} 次 GA（50×50），采集完整适应度分解`)
  console.log('='.repeat(110))

  const results = []

  for (let i = 1; i <= N; i++) {
    const fitness = new ConcreteFitness(snapshot, 45, 210, {})
    const fitnessWrapper = async (rawGenes) => {
      const decoded = decodeGenes(rawGenes, snapshot)
      return await fitness.evaluate(decoded)
    }
    const optimizer = new GeneticOptimizer({ populationSize: 50, generations: 50 })
    const result = await optimizer.run(fitnessWrapper, buildGeneSpec(snapshot))
    const best = result.bestSolutions[0]
    const g = best.genes

    const decoded = decodeGenes(g, snapshot)
    const r = await fitness.evaluate(decoded)
    const amounts = r.amounts || {}
    const additiveMass = (amounts.flyAsh || 0) + (amounts.slag || 0)
      + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
    const binder = (amounts.cement || 0) + additiveMass
    const water = amounts.water || 0
    // 真实总掺量百分比（相对于胶凝材料）
    const additiveTotal = binder > 0 ? (additiveMass / binder) * 100 : 0

    results.push({
      idx: i,
      wb: g.wb, sandRatio: g.sandRatio, spDosage: g.spDosage,
      water, binder,
      additiveMass,
      additiveTotal,
      strength: r.predictions.strength28d,
      fitness: r.fitness,
      realCost: r.realCost,
      strengthPenalty: r.strengthGap > 0 ? r.strengthGap * 2 : 0,
      strengthSurplusPenalty: r.strengthSurplusPenalty || 0,
      spDeviationPenalty: r.spDeviationPenalty,
      sandRatioPenalty: r.sandRatioPenalty,
      additivePenalty: r.additivePenalty
    })

    console.log(
      `#${String(i).padEnd(3)}` +
      ` w/b=${g.wb.toFixed(4).padStart(7)}` +
      ` 砂率=${g.sandRatio.toFixed(2).padStart(6)}` +
      ` SP=${g.spDosage.toFixed(2).padStart(5)}` +
      ` 水=${water.toFixed(1).padStart(7)}` +
      ` 胶=${binder.toFixed(1).padStart(7)}` +
      ` 掺=${additiveMass.toFixed(1).padStart(6)}` +
      ` 掺%=${additiveTotal.toFixed(2).padStart(6)}` +
      ` 强=${r.predictions.strength28d.toFixed(2).padStart(7)}` +
      ` 成本=${r.realCost.toFixed(2).padStart(8)}` +
      ` fit=${r.fitness.toFixed(2).padStart(9)}`
    )
  }

  // ========== 步骤2：等价解识别 ==========
  console.log('\n' + '='.repeat(110))
  console.log('步骤2：等价解对识别（Δfitness < 3元视为等价）')
  console.log('='.repeat(110))

  const pairs = []
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i], b = results[j]
      const dFit = Math.abs(a.fitness - b.fitness)
      if (dFit < 3) {
        // 配比距离（归一化欧氏距离）
        const dWb = Math.abs(a.wb - b.wb) / 0.3
        const dSand = Math.abs(a.sandRatio - b.sandRatio) / 25
        const dSp = Math.abs(a.spDosage - b.spDosage) / 4
        const dWater = Math.abs(a.water - b.water) / 50
        const dRatio = Math.sqrt(dWb ** 2 + dSand ** 2 + dSp ** 2 + dWater ** 2)
        pairs.push({ i: a.idx, j: b.idx, dFit, dRatio, a, b })
      }
    }
  }

  if (pairs.length === 0) {
    console.log('未发现等价解对（所有解的适应度差异 > 3元）→ GA已较稳定')
  } else {
    console.log('对#  解A vs 解B   Δfit    Δ配比    诊断')
    console.log('-'.repeat(80))
    pairs.sort((x, y) => y.dRatio - x.dRatio)
    for (let k = 0; k < pairs.length; k++) {
      const p = pairs[k]
      const diag = p.dRatio > 1.0 ? '★ 等价但配比差异大（平坦方向）' :
                  p.dRatio > 0.5 ? '⚠ 等价且配比中等差异' : '✓ 等价且配比接近'
      console.log(
        `#${String(k + 1).padEnd(4)}` +
        ` #${p.i} vs #${p.j}   ` +
        `Δfit=${p.dFit.toFixed(2).padStart(5)}  ` +
        `Δ配比=${p.dRatio.toFixed(3).padStart(6)}  ` +
        diag
      )
    }
  }

  // ========== 步骤3：平坦方向诊断 ==========
  console.log('\n' + '='.repeat(110))
  console.log('步骤3：平坦方向诊断（等价对间各维度差异贡献）')
  console.log('='.repeat(110))

  if (pairs.length === 0) {
    console.log('无等价对，跳过平坦方向诊断')
  } else {
    // 对每对等价解，计算各维度的差异
    const dims = [
      { key: 'realCost', name: '真实成本', scale: 1 },
      { key: 'strengthPenalty', name: '强度不足罚', scale: 1 },
      { key: 'strengthSurplusPenalty', name: '强度余量罚', scale: 1 },
      { key: 'spDeviationPenalty', name: '减水剂偏差罚', scale: 1 },
      { key: 'sandRatioPenalty', name: '砂率合理性罚', scale: 1 },
      { key: 'additivePenalty', name: '掺合料超限罚', scale: 1 }
    ]

    console.log('维度             等价对间平均Δ    最大Δ    最小Δ    诊断')
    console.log('-'.repeat(85))

    for (const dim of dims) {
      const deltas = pairs.map(p => Math.abs(p.a[dim.key] - p.b[dim.key]))
      const mean = deltas.reduce((s, x) => s + x, 0) / deltas.length
      const max = Math.max(...deltas)
      const min = Math.min(...deltas)

      let diag
      if (mean < 0.1) {
        diag = '✓ 维度饱和（已无差异）'
      } else if (mean > 2.0) {
        diag = '★★ 主导抵消方向（需加强）'
      } else if (mean > 0.5) {
        diag = '★ 次主导方向'
      } else {
        diag = '○ 普通波动'
      }

      console.log(
        dim.name.padEnd(16) +
        `${mean.toFixed(3).padStart(12)}` +
        `${max.toFixed(3).padStart(9)}` +
        `${min.toFixed(3).padStart(9)}    ${diag}`
      )
    }
  }

  // ========== 步骤4：完整分解表 ==========
  console.log('\n' + '='.repeat(110))
  console.log('步骤4：完整适应度分解表（按适应度升序）')
  console.log('='.repeat(110))

  const sorted = [...results].sort((a, b) => a.fitness - b.fitness)
  console.log(
    '解#  '.padEnd(5) +
    'fitness'.padStart(10) +
    '成本'.padStart(9) +
    '强度不足'.padStart(9) +
    '强度余量'.padStart(9) +
    'SP偏差'.padStart(8) +
    '砂率罚'.padStart(8) +
    '掺合料'.padStart(8) +
    '  ← 罚分组成'
  )
  console.log('-'.repeat(85))
  for (const r of sorted) {
    const compose =
      `成本=${r.realCost.toFixed(1)} + ` +
      `不足=${r.strengthPenalty.toFixed(2)} + ` +
      `余量=${r.strengthSurplusPenalty.toFixed(2)} + ` +
      `SP=${r.spDeviationPenalty.toFixed(2)} + ` +
      `砂率=${r.sandRatioPenalty.toFixed(2)} + ` +
      `掺=${r.additivePenalty.toFixed(2)}`
    console.log(
      `#${r.idx}`.padEnd(5) +
      r.fitness.toFixed(2).padStart(10) +
      r.realCost.toFixed(2).padStart(9) +
      r.strengthPenalty.toFixed(2).padStart(9) +
      r.strengthSurplusPenalty.toFixed(2).padStart(9) +
      r.spDeviationPenalty.toFixed(2).padStart(8) +
      r.sandRatioPenalty.toFixed(2).padStart(8) +
      r.additivePenalty.toFixed(2).padStart(8) +
      '  ← ' + compose
    )
  }

  // ========== 步骤5：自动诊断结论 ==========
  console.log('\n' + '='.repeat(110))
  console.log('步骤5：自动诊断结论')
  console.log('='.repeat(110))

  const fitValues = results.map(r => r.fitness)
  const fitMean = fitValues.reduce((s, x) => s + x, 0) / fitValues.length
  const fitStd = Math.sqrt(fitValues.reduce((s, x) => s + (x - fitMean) ** 2, 0) / fitValues.length)
  const fitRange = Math.max(...fitValues) - Math.min(...fitValues)

  console.log(`适应度统计：均值=${fitMean.toFixed(2)} 标准差=${fitStd.toFixed(2)} 跨距=${fitRange.toFixed(2)}`)
  console.log(`等价对数量：${pairs.length}/${results.length * (results.length - 1) / 2} 对`)

  if (pairs.length === 0) {
    console.log('\n[结论] GA 已较稳定，适应度地形存在明显梯度')
    console.log('[建议] 无需调整，可保持当前参数')
  } else {
    // 找出最大配比距离的等价对
    const maxRatioPair = pairs.reduce((m, p) => p.dRatio > m.dRatio ? p : m)
    console.log(`\n[最平坦方向] 解#${maxRatioPair.i} vs 解#${maxRatioPair.j}`)
    console.log(`  配比差异 Δ=${maxRatioPair.dRatio.toFixed(3)}，但适应度差异仅 ${maxRatioPair.dFit.toFixed(2)} 元`)

    // 分析这一对的差异构成
    const a = maxRatioPair.a, b = maxRatioPair.b
    console.log(`  解#${a.idx}: w/b=${a.wb.toFixed(4)} 水=${a.water.toFixed(1)} 砂率=${a.sandRatio.toFixed(2)} 强度=${a.strength.toFixed(2)}`)
    console.log(`  解#${b.idx}: w/b=${b.wb.toFixed(4)} 水=${b.water.toFixed(1)} 砂率=${b.sandRatio.toFixed(2)} 强度=${b.strength.toFixed(2)}`)

    const deltas = [
      { name: '成本', val: Math.abs(a.realCost - b.realCost) },
      { name: '强度不足罚', val: Math.abs(a.strengthPenalty - b.strengthPenalty) },
      { name: '强度余量罚', val: Math.abs(a.strengthSurplusPenalty - b.strengthSurplusPenalty) },
      { name: 'SP偏差罚', val: Math.abs(a.spDeviationPenalty - b.spDeviationPenalty) },
      { name: '砂率罚', val: Math.abs(a.sandRatioPenalty - b.sandRatioPenalty) },
      { name: '掺合料罚', val: Math.abs(a.additivePenalty - b.additivePenalty) }
    ]
    deltas.sort((x, y) => y.val - x.val)
    console.log('\n  最平坦对差异构成（降序）：')
    for (const d of deltas) {
      const bar = '█'.repeat(Math.round(d.val * 2))
      console.log(`    ${d.name.padEnd(12)} Δ=${d.val.toFixed(2).padStart(7)} ${bar}`)
    }

    // 自动建议
    console.log('\n[建议]')
    const maxDelta = deltas[0]
    if (maxDelta.val > 2.0) {
      console.log(`  ${maxDelta.name} 是主导抵消方向，差异达 ${maxDelta.val.toFixed(2)}`)
      console.log(`  → 可考虑加强该维度的罚分梯度，打破等价性`)
    } else if (maxDelta.val < 0.3) {
      console.log(`  所有维度差异都很小（最大 ${maxDelta.val.toFixed(2)}）`)
      console.log(`  → 适应度地形整体平坦，需新增约束维度（如耐久性、和易性、徐变等）`)
    } else {
      console.log(`  ${maxDelta.name} 差异中等（${maxDelta.val.toFixed(2)}），可适度加强`)
    }
  }
}

main().catch(e => console.error('错误:', e))
