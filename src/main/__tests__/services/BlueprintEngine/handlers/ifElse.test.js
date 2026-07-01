const handleIfElse = require('../../../../services/BlueprintEngine/handlers/ifElse')

describe('handleIfElse', () => {
  test('条件为真 → 执行 then 分支', async () => {
    const cm = { snapshot: () => ({ type: '碎石' }) }
    const dispatch = jest.fn()
    await handleIfElse({
      condition: 'type == "碎石"',
      then: [{ type: 'const', var: 'a', value: 0.53 }],
      else: [{ type: 'const', var: 'a', value: 0.49 }]
    }, cm, dispatch)
    expect(dispatch).toHaveBeenCalledWith({ type: 'const', var: 'a', value: 0.53 })
  })

  test('条件为假 → 执行 else 分支', async () => {
    const cm = { snapshot: () => ({ type: '卵石' }) }
    const dispatch = jest.fn()
    await handleIfElse({
      condition: 'type == "碎石"',
      then: [{ type: 'const', var: 'a', value: 0.53 }],
      else: [{ type: 'const', var: 'a', value: 0.49 }]
    }, cm, dispatch)
    expect(dispatch).toHaveBeenCalledWith({ type: 'const', var: 'a', value: 0.49 })
  })
})
