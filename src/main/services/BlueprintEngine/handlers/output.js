function round(value, precision) {
  const m = Math.pow(10, precision)
  return Math.round(value * m) / m
}

async function handleOutput(step, context) {
  const value = context.get(step.var)
  if (value === undefined) {
    throw new Error(`输出变量"${step.var}"未定义`)
  }
  const precision = step.precision !== undefined ? step.precision : 0
  context._results = context._results || {}
  context._results[step.var] = {
    name: step.name || step.var,
    value: round(value, precision),
    unit: step.unit || ''
  }
}

module.exports = handleOutput
