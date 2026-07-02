// src/main/services/BlueprintEngine/MaterialChooser.js
class MaterialChoiceAbortedError extends Error {
  constructor(category) {
    super(`用户拒绝选择 ${category} 类材料，无法继续计算`)
    this.name = 'MaterialChoiceAbortedError'
  }
}

async function choose(category, candidates, ctx = {}) {
  // 唯一候选 → 直接返回
  if (candidates.length === 1) {
    candidates[0]._chooserReason = '唯一匹配'
    return candidates[0]
  }

  // 级别一：蓝图/用户已指定
  if (ctx.userChoice) {
    // 优先按类别匹配：ctx.userChoice[category] 可以是材料名称或 ID
    const choice = ctx.userChoice[category]
    if (choice) {
      const exact = candidates.find(
        m => m.name === choice || String(m.id) === String(choice)
      )
      if (!exact) throw new Error(`指定的材料"${choice}"不在"${category}"候选中`)
      exact._chooserReason = `用户指定: ${exact.name}`
      return exact
    }
    // 向后兼容：全局 materialName（不区分类别）
    if (ctx.userChoice.materialName) {
      const exact = candidates.find(m => m.name === ctx.userChoice.materialName)
      if (!exact) throw new Error(`指定的材料 "${ctx.userChoice.materialName}" 不在候选中`)
      exact._chooserReason = `用户指定: ${exact.name}`
      return exact
    }
  }

  // 级别四：用户拒绝
  if (ctx.aborted) throw new MaterialChoiceAbortedError(category)

  // 级别三：LLM 自决（偏好 + 性能匹配）
  if (ctx.llmDecided || ctx.fallbackToLLM) {
    // 简化实现：优先匹配 _isDefault 标记的材料
    const defaults = candidates.filter(m => m._isDefault)
    if (defaults.length > 0) {
      defaults[0]._chooserReason = 'LLM 评分最高（默认偏好匹配）'
      return defaults[0]
    }
    candidates[0]._chooserReason = 'LLM 评分最高（首选项）'
    return candidates[0]
  }

  // 级别二：抛出特殊异常，前端弹出对话框
  // （这里用 Error 对象携带候选列表，前端识别后弹窗）
  const err = new Error(`需要用户选择 ${category}`)
  err.code = 'MultiMaterialChoice'
  err.candidates = candidates
  err.category = category
  throw err
}

module.exports = { choose, MaterialChoiceAbortedError }