const { safeEvaluate, extractVariables } =
  require('../../../services/BlueprintEngine/FormulaParser')

describe('FormulaParser', () => {
  test('四则运算 + 幂运算', () => {
    expect(safeEvaluate('1 + 2', {})).toBe(3)
    expect(safeEvaluate('2 ** 3', {})).toBe(8)
  })

  test('变量代入', () => {
    expect(safeEvaluate('a + b * 2', { a: 1, b: 2 })).toBe(5)
  })

  test('白名单函数：round/max/min/sqrt/abs', () => {
    expect(safeEvaluate('round(3.14159, 2)', {})).toBe(3.14)
    expect(safeEvaluate('max(1, 5, 3)', {})).toBe(5)
    expect(safeEvaluate('sqrt(16)', {})).toBe(4)
  })

  test('extractVariables 提取变量名', () => {
    expect(extractVariables('a + b * 2')).toEqual(['a', 'b'])
  })

  test('非法函数被拒绝', () => {
    expect(() => safeEvaluate('eval("1+1")', {})).toThrow(/不允许/)
  })
})