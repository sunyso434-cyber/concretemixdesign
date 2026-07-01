async function handleConst(step, context) {
  context.set(step.var, step.value)
}

module.exports = handleConst
