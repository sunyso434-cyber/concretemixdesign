async function handleIfElse(step, context, dispatch) {
  const condition = step.condition
  // 简单条件求值：把变量替换为字面值后 eval（安全因为变量值都是数字/字符串）
  const varValues = context.snapshot()
  let condExpr = condition
  for (const [name, value] of Object.entries(varValues)) {
    condExpr = condExpr.replace(
      new RegExp(`\\b${name}\\b`, 'g'),
      typeof value === 'string' ? JSON.stringify(value) : value
    )
  }
  const conditionMet = Boolean(eval(condExpr))
  const branchSteps = conditionMet ? step.then : (step.else || [])
  for (const subStep of branchSteps) {
    await dispatch(subStep)
  }
}

module.exports = handleIfElse
