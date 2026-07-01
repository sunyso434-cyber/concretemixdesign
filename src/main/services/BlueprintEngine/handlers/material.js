const MaterialChooser = require('../MaterialChooser')

function matchesRequirement(material, req) {
  const value = material[req.property]
  if (value === undefined || value === null) return false
  if (req.min !== undefined && value < req.min) return false
  if (req.max !== undefined && value > req.max) return false
  return true
}

async function handleMaterial(step, context, materialsIndex, runtimeCtx = {}) {
  const { category, requirements, property, name } = step.material_query

  let candidates = materialsIndex[category]
  if (!candidates || candidates.length === 0) {
    throw new Error(`系统中没有"${category}"类材料，请先在原材料管理中录入`)
  }

  // 运行时填入的 name 精确匹配
  if (name) {
    const exact = candidates.find(m => m.name === name)
    if (!exact) throw new Error(`指定的材料"${name}"不在"${category}"类别中`)
    candidates = [exact]
  }

  if (requirements && requirements.length > 0) {
    candidates = candidates.filter(m => requirements.every(r => matchesRequirement(m, r)))
    if (candidates.length === 0) {
      throw new Error(
        `"${category}"类别中没有满足性能要求的材料：\n` +
        requirements.map(r => `  - ${r.property} ${r.min !== undefined ? '≥ ' + r.min : ''}${r.max !== undefined ? ' ≤ ' + r.max : ''}`).join('\n')
      )
    }
  }

  const material = await MaterialChooser.choose(category, candidates, runtimeCtx)

  const value = material[property]
  if (value === undefined || value === null) {
    throw new Error(`材料"${material.name}"缺少属性"${property}"`)
  }

  context.set(step.var, Number(value))
}

module.exports = handleMaterial