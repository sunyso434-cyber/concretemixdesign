const handleInput = require('../../../../services/BlueprintEngine/handlers/input')

describe('handleInput', () => {
  let cm, userParams
  beforeEach(() => {
    cm = { has: jest.fn(), set: jest.fn(), get: jest.fn() }
    userParams = new Map([['strength_grade', 'C30']])
  })

  test('用户已提供 → 跳过', async () => {
    cm.has.mockReturnValue(true)
    await handleInput({ var: 'fcu_k', from: 'strength_grade' }, cm, userParams)
    expect(cm.set).not.toHaveBeenCalled()
  })

  test('从用户参数读取', async () => {
    cm.has.mockReturnValue(false)
    await handleInput({ var: 'fcu_k', from: 'strength_grade' }, cm, userParams)
    expect(cm.set).toHaveBeenCalledWith('fcu_k', 'C30')
  })

  test('value_map 字符串→数值映射', async () => {
    cm.has.mockReturnValue(false)
    await handleInput({ var: 'fcu_k', from: 'strength_grade', value_map: { C30: 30 } }, cm, userParams)
    expect(cm.set).toHaveBeenCalledWith('fcu_k', 30)
  })

  test('缺参数且无 default → 抛错', async () => {
    cm.has.mockReturnValue(false)
    userParams = new Map()
    await expect(handleInput({ var: 'fcu_k', from: 'strength_grade' }, cm, userParams))
      .rejects.toThrow(/缺少必填参数/)
  })

  test('使用 default 值', async () => {
    cm.has.mockReturnValue(false)
    await handleInput({ var: 'slump', default: 180 }, cm, userParams)
    expect(cm.set).toHaveBeenCalledWith('slump', 180)
  })
})