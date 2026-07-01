const { safeEvaluate, extractVariables } = require('../FormulaParser')

async function handleFormula(step, context) {
  const variables = extractVariables(step.expr)
  for (const v of variables) {
    if (!context.has(v)) {
      throw new Error(`公式中引用的变量"${v}"尚未定义`)
    }
  }
  const values = Object.fromEntries(variables.map(v => [v, context.get(v)]))
  const result = safeEvaluate(step.expr, values)
  context.set(step.var, result)
}

module.exports = handleFormula
