const handleOutput = require('../../../../services/BlueprintEngine/handlers/output')

describe('handleOutput', () => {
  test('输出变量并保留 precision', async () => {
    const cm = { get: () => 185.123, _results: {} }
    await handleOutput({ var: 'm_wa', name: '水', unit: 'kg/m³', precision: 1 }, cm)
    expect(cm._results.m_wa).toEqual({ name: '水', value: 185.1, unit: 'kg/m³' })
  })

  test('变量未定义 → 抛错', async () => {
    const cm = { get: () => undefined }
    await expect(handleOutput({ var: 'x' }, cm)).rejects.toThrow(/未定义/)
  })

  test('precision 默认 0', async () => {
    const cm = { get: () => 3.7, _results: {} }
    await handleOutput({ var: 'x' }, cm)
    expect(cm._results.x.value).toBe(4)
  })
})
