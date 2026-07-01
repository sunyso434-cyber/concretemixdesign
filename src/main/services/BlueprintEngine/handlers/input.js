async function handleInput(step, context, userParams) {
  if (context.has(step.var)) return

  if (step.from && userParams.has(step.from)) {
    const raw = userParams.get(step.from)
    if (step.value_map) {
      context.set(step.var, step.value_map[raw])
      return
    }
    context.set(step.var, raw)
    return
  }

  if (step.default !== undefined) {
    context.set(step.var, step.default)
    return
  }

  throw new Error(`缺少必填参数: ${step.from || step.var}`)
}

module.exports = handleInput