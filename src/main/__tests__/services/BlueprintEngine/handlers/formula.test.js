const handleFormula = require('../../../../services/BlueprintEngine/handlers/formula')

describe('handleFormula', () => {
  let cm
  beforeEach(() => {
    cm = {
      has: jest.fn(),
      get: jest.fn(),
      set: jest.fn()
    }
  })

  test('正常求值', async () => {
    cm.has.mockReturnValue(true)
    cm.get.mockImplementation(name => ({ a: 10, b: 5 }[name]))
    await handleFormula({ var: 'c', expr: 'a + b * 2' }, cm)
    expect(cm.set).toHaveBeenCalledWith('c', 20)
  })

  test('变量未定义 → 抛错', async () => {
    cm.has.mockReturnValue(false)
    await expect(handleFormula({ var: 'c', expr: 'a + b' }, cm))
      .rejects.toThrow(/尚未定义/)
  })
})
