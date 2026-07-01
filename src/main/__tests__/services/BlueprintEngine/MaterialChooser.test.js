// src/main/__tests__/services/BlueprintEngine/MaterialChooser.test.js
const MaterialChooser = require('../../../services/BlueprintEngine/MaterialChooser')

describe('MaterialChooser', () => {
  test('单一候选 → 直接返回', async () => {
    const result = await MaterialChooser.choose('水泥', [{ name: 'P.O42.5' }], { userChoice: null })
    expect(result.name).toBe('P.O42.5')
  })

  test('多个候选 + userChoice 已设置 → 走用户指定', async () => {
    const candidates = [
      { name: 'A' }, { name: 'B' }
    ]
    const result = await MaterialChooser.choose('水泥', candidates, {
      userChoice: { materialName: 'B' }
    })
    expect(result.name).toBe('B')
  })

  test('多个候选 + 无 userChoice + 用户不选择 → 走 LLM 自决（mock 偏好匹配）', async () => {
    const candidates = [
      { name: 'A', _isDefault: true },
      { name: 'B', _isDefault: false }
    ]
    const result = await MaterialChooser.choose('水泥', candidates, {
      userChoice: null,
      llmDecided: true
    })
    expect(result.name).toBe('A') // 偏好匹配胜出
  })

  test('用户拒绝选择 → 抛 MaterialChoiceAbortedError', async () => {
    await expect(MaterialChooser.choose('水泥', [{ name: 'A' }, { name: 'B' }], {
      userChoice: null,
      aborted: true
    })).rejects.toThrow(/用户拒绝/)
  })
})