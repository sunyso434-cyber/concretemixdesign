const SharedSchemas = require('../SharedSchemas')

describe('SharedSchemas', () => {
  test('应该导出 4 个共享 schema', () => {
    expect(Object.keys(SharedSchemas).sort()).toEqual([
      'admixtureParams',
      'materialIds',
      'materialQuery',
      'tempSettings'
    ])
  })

  test('每个 schema 导出都应是合法对象', () => {
    Object.entries(SharedSchemas).forEach(([name, schema]) => {
      expect(typeof schema).toBe('object')
      expect(schema).not.toBeNull()
      expect(Array.isArray(schema)).toBe(false)
    })
  })

  test('object 类型的 schema 应有 properties 字段', () => {
    const objectSchemas = ['tempSettings', 'materialIds', 'admixtureParams']
    objectSchemas.forEach(name => {
      const schema = SharedSchemas[name]
      // 顶层 type 必须是字符串 'object' 且包含 properties
      expect(schema.type).toBe('object')
      expect(typeof schema.properties).toBe('object')
      expect(Object.keys(schema.properties).length).toBeGreaterThan(0)
    })
  })

  test('tempSettings 应包含关键回归参数', () => {
    const props = SharedSchemas.tempSettings.properties
    expect(props.regressionAlphaA).toBeDefined()
    expect(props.regressionAlphaA.type).toBe('number')
    expect(props.regressionAlphaB).toBeDefined()
    expect(props.strengthStdDev).toBeDefined()
  })

  test('materialIds 应包含水泥/细骨料/粗骨料字段', () => {
    const props = SharedSchemas.materialIds.properties
    expect(props.cementId.type).toBe('integer')
    expect(props.sandIds.type).toBe('array')
    expect(props.sandIds.items.type).toBe('integer')
    expect(props.stoneIds.type).toBe('array')
    expect(props.stoneIds.items.type).toBe('integer')
  })

  test('materialQuery 应限定材料类型枚举', () => {
    const schema = SharedSchemas.materialQuery
    // materialQuery 在文件里的结构：type 字段是一个嵌套对象
    expect(schema.type).toBeDefined()
    expect(schema.type.type).toBe('string')
    expect(Array.isArray(schema.type.enum)).toBe(true)
    expect(schema.type.enum).toContain('水泥')
    expect(schema.type.enum).toContain('细骨料')
    expect(schema.type.enum).toContain('减水剂')
  })

  test('admixtureParams 应包含掺量与砂率字段', () => {
    const props = SharedSchemas.admixtureParams.properties
    expect(props.flyAshDosage.type).toBe('number')
    expect(props.slagDosage.type).toBe('number')
    expect(props.sandRatio.type).toBe('number')
    // 计算方法枚举
    expect(props.calculationMethod.enum).toEqual(['absolute', 'mass'])
  })

  test('序列化后应是合法 JSON（无循环引用/函数）', () => {
    expect(() => JSON.stringify(SharedSchemas)).not.toThrow()
    const round = JSON.parse(JSON.stringify(SharedSchemas))
    expect(round).toEqual(SharedSchemas)
  })

  test('不应包含 $ref（当前实现是平铺 schema）', () => {
    const json = JSON.stringify(SharedSchemas)
    expect(json).not.toMatch(/\$ref/)
  })
})
