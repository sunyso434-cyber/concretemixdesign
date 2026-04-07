// 测试前端 adjustedResult 成本合并逻辑，模拟 MixDesignPage.jsx 中的实现
(function(){
  const calculationResult = {
    materials: {
      cement: 300,
      flyAsh: 50,
      slag: 0,
      sand: 750,
      stone: 1050,
      superplasticizer: 6,
      sand_7: 375,
      sand_8: 375
    },
    materialCosts: {},
    totalCost: 0,
    fineAggregateBreakdown: [ { id: 7, ratio: 0.5 }, { id: 8, ratio: 0.5 } ]
  }

  const materialsList = [
    { id: 7, name: '机制砂', price: 120, finenessModulus: 2.7 },
    { id: 8, name: '河砂', price: 150, finenessModulus: 2.4 },
    { id: 1, name: 'P.O 42.5R水泥', price: 450 }
  ]

  // 构造 calculationResult.materialCosts（模拟后端返回结构）
  const m = calculationResult.materials
  calculationResult.materialCosts.cement = (m.cement * 450) / 1000
  calculationResult.materialCosts.flyAsh = (m.flyAsh * 180) / 1000
  calculationResult.materialCosts.slag = 0
  calculationResult.materialCosts['sand_7'] = (m['sand_7'] * 120) / 1000
  calculationResult.materialCosts['sand_8'] = (m['sand_8'] * 150) / 1000
  calculationResult.materialCosts.sand = calculationResult.materialCosts['sand_7'] + calculationResult.materialCosts['sand_8']
  calculationResult.materialCosts.stone = (m.stone * 100) / 1000
  calculationResult.materialCosts.superplasticizer = (m.superplasticizer * 2500) / 1000
  calculationResult.totalCost = Object.values(calculationResult.materialCosts).reduce((s,v)=>s+v,0)

  console.log('原 calculationResult.materialCosts:', calculationResult.materialCosts)
  console.log('原 totalCost:', calculationResult.totalCost.toFixed(2))

  // 模拟 MixDesignPage.jsx 中的实时调整逻辑
  const watchedSand = [7,8]
  const selectedSand = Array.isArray(watchedSand) ? watchedSand : (watchedSand ? [watchedSand] : [])
  const sandMaterials = materialsList.filter(m => selectedSand.some(id => String(id) === String(m.id)))

  // 使用 calculationResult.fineAggregateBreakdown 的比例作为回退（与前端代码一致）
  let r1 = null
  if (Array.isArray(calculationResult.fineAggregateBreakdown) && calculationResult.fineAggregateBreakdown.length === 2) {
    const b0 = calculationResult.fineAggregateBreakdown.find(b => String(b.id) === String(sandMaterials[0].id))
    r1 = b0 ? b0.ratio : 0.5
  } else {
    r1 = 0.5
  }
  const r2 = 1 - r1

  const totalSand = calculationResult.materials?.sand || 0
  const newMaterials = { ...calculationResult.materials }
  newMaterials[`sand_${sandMaterials[0].id}`] = totalSand * r1
  newMaterials[`sand_${sandMaterials[1].id}`] = totalSand * r2
  newMaterials.sand = totalSand

  // 重新计算成本
  const baseCosts = { ...calculationResult.materialCosts }
  Object.keys(baseCosts).forEach(k => { if (k.startsWith('sand_')) delete baseCosts[k] })
  if (baseCosts.sand !== undefined) delete baseCosts.sand

  let newTotal = 0
  Object.keys(baseCosts).forEach(k => { newTotal += baseCosts[k] || 0 })

  const newCosts = { ...baseCosts }
  const price1 = parseFloat(sandMaterials[0].price) || 0
  const price2 = parseFloat(sandMaterials[1].price) || 0

  if (price1 > 0) {
    newCosts[`sand_${sandMaterials[0].id}`] = (newMaterials[`sand_${sandMaterials[0].id}`] * price1) / 1000
    newTotal += newCosts[`sand_${sandMaterials[0].id}`]
  }
  if (price2 > 0) {
    newCosts[`sand_${sandMaterials[1].id}`] = (newMaterials[`sand_${sandMaterials[1].id}`] * price2) / 1000
    newTotal += newCosts[`sand_${sandMaterials[1].id}`]
  }
  newCosts.sand = (newCosts[`sand_${sandMaterials[0].id}`] || 0) + (newCosts[`sand_${sandMaterials[1].id}`] || 0)

  console.log('\n调整后 newCosts:', newCosts)
  console.log('调整后 newTotal:', newTotal.toFixed(2))
  // 对比：displayResult.totalCost （应为 newTotal） 与 calculationResult.totalCost
  console.log('\n对比：')
  console.log('原 calculationResult.totalCost (可能包含重复):', calculationResult.totalCost.toFixed(2))
  // 按照已修复逻辑规范化原始 materialCosts 的总成本（当存在 sand_*/stone_* 时跳过 sand/stone）
  const normHasSandDetail = Object.keys(calculationResult.materialCosts).some(k => k.startsWith('sand_'))
  const normHasStoneDetail = Object.keys(calculationResult.materialCosts).some(k => k.startsWith('stone_'))
  let normalizedOriginal = 0
  Object.entries(calculationResult.materialCosts).forEach(([k, v]) => {
    if (k === 'sand' && normHasSandDetail) return
    if (k === 'stone' && normHasStoneDetail) return
    normalizedOriginal += v || 0
  })
  console.log('规范化后的原始 totalCost:', normalizedOriginal.toFixed(2))
  console.log('adjusted display totalCost (newTotal):', newTotal.toFixed(2))

  // 检查差异
  console.log('\n检查重复：')
  console.log('原始 - 规范化 差值:', (calculationResult.totalCost - normalizedOriginal).toFixed(4))
  console.log('规范化 - 调整后 差值:', (normalizedOriginal - newTotal).toFixed(4))

  // 输出每项的合计以便人工核对
  const shownItems = Object.keys(newCosts).filter(k => !k.startsWith('sand_') && k !== 'sand')
  let shownSum = 0
  shownItems.forEach(k => { shownSum += newCosts[k] || 0 })
  const sandSum = (newCosts[`sand_${sandMaterials[0].id}`] || 0) + (newCosts[`sand_${sandMaterials[1].id}`] || 0)
  console.log('非砂项合计:', shownSum.toFixed(2))
  console.log('细骨料分项合计:', sandSum.toFixed(2))
  console.log('显示合计（非砂 + 细骨料分项）:', (shownSum + sandSum).toFixed(2))

})();
