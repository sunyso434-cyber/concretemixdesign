function blendFineAggregates(aggregates, ratios) {
  const totalWeight = ratios.reduce((sum, ratio) => sum + ratio, 0)
  if (Math.abs(totalWeight - 1) > 0.01) {
    ratios = ratios.map(ratio => ratio / totalWeight)
  }

  const blended = {
    id: 'blended_' + aggregates.map(aggregate => aggregate.id).join('_'),
    name: '混合砂',
    type: '细骨料',
    price: 0,
    finenessModulus: 0,
    mudContent: 0,
    mbValue: 0,
    originalRatios: [...ratios],
    originalAggregateIds: aggregates.map(aggregate => aggregate.id),
    originalAggregateNames: aggregates.map(aggregate => aggregate.name)
  }

  aggregates.forEach((aggregate, index) => {
    const ratio = ratios[index]
    blended.price += (aggregate.price || 0) * ratio
    blended.finenessModulus += (aggregate.finenessModulus || 2.7) * ratio
    blended.mudContent += (aggregate.mudContent || 0) * ratio
    blended.mbValue += (aggregate.mbValue || 0) * ratio
  })
  return blended
}

function buildIterationMaterials(baseMaterials, blendRatios = {}) {
  const materials = { ...baseMaterials }
  if (
    blendRatios.sand &&
    Array.isArray(baseMaterials.sand) &&
    baseMaterials.sand.length > 1
  ) {
    materials.sand = blendFineAggregates(baseMaterials.sand, blendRatios.sand)
  }
  return materials
}

function generateFineAggregateRatios(fineAggregates) {
  const count = fineAggregates.length
  if (count <= 1) return [null]

  const pairs = []
  if (count === 2) {
    pairs.push([0, 1])
  } else {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) pairs.push([i, j])
    }
  }

  const ratios = []
  for (const [idxA, idxB] of pairs) {
    for (let percent = 0; percent <= 100; percent += 5) {
      ratios.push([percent / 100, (100 - percent) / 100, idxA, idxB])
    }
  }
  return ratios
}

function getMaterialList(material) {
  if (!material || (Array.isArray(material) && material.length === 0)) return [null]
  return Array.isArray(material) ? material : [material]
}

function validateFinenessModulus(actualFM, targetFM, tolerance = 0.5) {
  return Math.abs(actualFM - targetFM) <= tolerance
}

function blendFineAggregatesForCost(sandCandidates, ratio) {
  if (!Array.isArray(sandCandidates) || sandCandidates.length < 1) return null
  if (!ratio || ratio.length === 0) return sandCandidates[0]

  let idxA
  let idxB
  let r1
  let r2
  if (ratio.length === 4) {
    [r1, r2, idxA, idxB] = ratio
  } else if (ratio.length === 2) {
    [r1, r2] = ratio
    idxA = 0
    idxB = 1
  } else {
    return sandCandidates[0]
  }

  const sandA = sandCandidates[idxA]
  const sandB = sandCandidates[idxB]
  if (!sandA) return sandA || sandB

  return {
    id: `blended_${sandA.id}_${sandB.id}_${Math.round(r1 * 100)}`,
    name: `${sandA.name || '砂A'}+${sandB.name || '砂B'} 混合`,
    type: '细骨料',
    price: (sandA.price || 0) * r1 + (sandB.price || 0) * r2,
    finenessModulus: (sandA.finenessModulus || 2.7) * r1 + (sandB.finenessModulus || 2.7) * r2,
    mbValue: (sandA.mbValue || 0.5) * r1 + (sandB.mbValue || 0.5) * r2,
    originalRatios: [r1, r2],
    originalAggregateIds: [sandA.id, sandB.id]
  }
}

function createRange(range, step) {
  const [min, max] = range
  const result = []
  for (let value = min; value <= max; value += step) result.push(value)
  if (result[result.length - 1] !== max) result.push(max)
  return result
}

function validateConstraints(result, constraints, userLimits = {}) {
  const strengthNum = parseInt(String(constraints.strength).replace('C', ''))
  if (result.targetStrength && result.targetStrength < strengthNum) return false
  if (userLimits.waterRatioRange) {
    const [minWbr, maxWbr] = userLimits.waterRatioRange
    if (result.waterRatio < minWbr || result.waterRatio > maxWbr) return false
  }

  const amounts = result.materials || {}
  const totalCementitious = (amounts.cement || 0) + (amounts.flyAsh || 0)
    + (amounts.slag || 0) + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
  if (totalCementitious <= 0 || totalCementitious < 200 || totalCementitious > 600) return false
  if (!amounts.water || amounts.water <= 0 || amounts.water > 250) return false
  return true
}

module.exports = {
  blendFineAggregates,
  buildIterationMaterials,
  generateFineAggregateRatios,
  getMaterialList,
  validateFinenessModulus,
  blendFineAggregatesForCost,
  createRange,
  validateConstraints
}
