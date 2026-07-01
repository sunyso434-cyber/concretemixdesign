// src/main/services/BlueprintEngine/FormulaParser.js
// 安全公式求值器：白名单 + Function 构造器 + 严格模式

const ALLOWED_FUNCTIONS = ['round', 'max', 'min', 'sqrt', 'abs']

// 函数名 -> 实际实现 的映射
// round 支持可选的小数位数参数：round(3.14159, 2) => 3.14
const FUNCTION_IMPL = {
  round: (value, decimals = 0) => {
    const factor = Math.pow(10, decimals)
    return Math.round(value * factor) / factor
  },
  max: Math.max,
  min: Math.min,
  sqrt: Math.sqrt,
  abs: Math.abs
}

/**
 * 从表达式中提取变量名（去重，排除白名单函数名和关键字）
 */
function extractVariables(expr) {
  const matches = expr.match(/[a-zA-Z_][a-zA-Z_0-9]*/g) || []
  const vars = matches.filter(m =>
    !ALLOWED_FUNCTIONS.includes(m) &&
    !['true', 'false', 'null', 'undefined'].includes(m)
  )
  return [...new Set(vars)]
}

/**
 * 安全求值表达式
 * @param {string} expr - 数学表达式
 * @param {object} vars - 变量字典
 * @returns {number} 计算结果
 */
function safeEvaluate(expr, vars) {
  // 拒绝可疑关键字（防止 prototype pollution 和函数构造逃逸）
  if (/function|eval|require|import|this|window|process/i.test(expr)) {
    throw new Error('表达式包含不允许的语法')
  }
  // 拒绝未声明的变量引用
  const declared = extractVariables(expr)
  for (const v of declared) {
    if (!(v in vars)) {
      throw new Error(`变量 "${v}" 未声明`)
    }
  }
  // 用 new Function 构造 + 白名单函数注入；strict 模式禁止 with/全局污染
  const fn = new Function(
    ...declared,
    ...ALLOWED_FUNCTIONS,
    `"use strict"; return (${expr});`
  )
  return fn(
    ...declared.map(v => vars[v]),
    ...ALLOWED_FUNCTIONS.map(name => FUNCTION_IMPL[name])
  )
}

module.exports = { safeEvaluate, extractVariables }