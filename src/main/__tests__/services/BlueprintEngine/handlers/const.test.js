const handleConst = require('../../../../services/BlueprintEngine/handlers/const')

describe('handleConst', () => {
  test('设置常数', async () => {
    const cm = { set: jest.fn() }
    await handleConst({ var: 'alpha_a', value: 0.53 }, cm)
    expect(cm.set).toHaveBeenCalledWith('alpha_a', 0.53)
  })
})
