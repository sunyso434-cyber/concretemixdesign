/**
 * jgj55-params skill 测试
 * 覆盖 5 个工具的 happy path + 6 个 error path
 */

// 注意：skill 还没实现，这里 require 会失败 —— 这是预期的红灯
const skills = require('../../skills/jgj55-params.js')

// skill 用数组导出 5 个工具
const skillByName = {}
for (const s of skills) {
  skillByName[s.name] = s
}

// 模拟 SkillRegistry 注入的 context
function makeContext() {
  return {
    systemService: {
      // mock 13 个 JGJ55 参数当前值
      _store: {
        regressionAlphaA: '0.53',
        regressionAlphaB: '0.20',
        strengthStdDev_C20: '4.0',
        strengthStdDev_C45: '5.0',
        strengthStdDev_C50: '6.0',
        superplasticizerDosage_C20: '1.6',
        superplasticizerDosage_C25: '1.7',
        superplasticizerDosage_C30: '1.8',
        superplasticizerDosage_C35: '1.9',
        superplasticizerDosage_C40: '2.0',
        superplasticizerDosage_C45: '2.1',
        superplasticizerDosage_C50: '2.2',
        waterReducingRatePer01Dosage: '2.0'
      },
      async getParamByName(name) {
        return this._store[name]
          ? { name, value: this._store[name] }
          : null
      },
      async setParam(name, value) {
        this._store[name] = String(value)
      },
      async deleteParam(name) {
        const existed = name in this._store
        delete this._store[name]
        return existed
      },
      async getAllParams() {
        return Object.entries(this._store).map(([name, value]) => ({
          name, value, type: 'jgj55'
        }))
      }
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {}
    }
  }
}

describe('jgj55-params skill', () => {
  test('1. list_jgj55_params: 返回 13 项', async () => {
    const skill = skillByName.list_jgj55_params
    const ctx = makeContext()
    const result = await skill.execute({}, ctx)
    expect(result.success).toBe(true)
    expect(result.count).toBe(13)
    expect(result.params).toHaveLength(13)
    // 验证其中一个
    const alphaA = result.params.find(p => p.name === 'regressionAlphaA')
    expect(alphaA.min).toBe(0.46)
    expect(alphaA.max).toBe(0.58)
    expect(alphaA.value).toBe('0.53')
  })

  test('2. get_jgj55_param: 查存在的', async () => {
    const skill = skillByName.get_jgj55_param
    const ctx = makeContext()
    const result = await skill.execute({ name: 'regressionAlphaA' }, ctx)
    expect(result.success).toBe(true)
    expect(result.param.name).toBe('regressionAlphaA')
    expect(result.param.value).toBe('0.53')
  })

  test('2b. get_jgj55_param: 查不存在的（INVALID_NAME）', async () => {
    const skill = skillByName.get_jgj55_param
    const ctx = makeContext()
    const result = await skill.execute({ name: 'nonExistent' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('INVALID_NAME')
  })

  test('3. update_jgj55_param: 改合法值', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    const result = await skill.execute({ name: 'regressionAlphaA', value: 0.55 }, ctx)
    expect(result.success).toBe(true)
    expect(ctx.systemService._store.regressionAlphaA).toBe('0.55')
  })

  test('3b. update_jgj55_param: 超范围（OUT_OF_RANGE）', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    const result = await skill.execute({ name: 'regressionAlphaA', value: 1.0 }, ctx)
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('OUT_OF_RANGE')
  })

  test('3c. update_jgj55_param: 非数字（INVALID_TYPE）', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    const result = await skill.execute({ name: 'regressionAlphaA', value: 'abc' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('INVALID_TYPE')
  })

  test('4. batch_update_jgj55_params: 全部成功', async () => {
    const skill = skillByName.batch_update_jgj55_params
    const ctx = makeContext()
    const result = await skill.execute(
      { updates: [
        { name: 'regressionAlphaA', value: 0.55 },
        { name: 'regressionAlphaB', value: 0.22 }
      ]},
      ctx
    )
    expect(result.success).toBe(true)
    expect(result.updated).toHaveLength(2)
    expect(result.failed).toHaveLength(0)
  })

  test('4b. batch_update_jgj55_params: 部分失败', async () => {
    const skill = skillByName.batch_update_jgj55_params
    const ctx = makeContext()
    const result = await skill.execute(
      { updates: [
        { name: 'regressionAlphaA', value: 0.55 },  // ok
        { name: 'regressionAlphaA', value: 99 }     // OUT_OF_RANGE
      ]},
      ctx
    )
    expect(result.success).toBe(false)
    expect(result.updated.length + result.failed.length).toBe(2)
  })

  test('4c. batch_update_jgj55_params: 空数组（BATCH_EMPTY）', async () => {
    const skill = skillByName.batch_update_jgj55_params
    const ctx = makeContext()
    const result = await skill.execute({ updates: [] }, ctx)
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('BATCH_EMPTY')
  })

  test('5. reset_jgj55_params: 重置全部', async () => {
    const skill = skillByName.reset_jgj55_params
    const ctx = makeContext()
    // 先乱改几个
    ctx.systemService._store.regressionAlphaA = '0.99'
    ctx.systemService._store.strengthStdDev_C50 = '7.7'
    const result = await skill.execute({}, ctx)
    expect(result.success).toBe(true)
    expect(result.resetCount).toBe(13)
    expect(ctx.systemService._store.regressionAlphaA).toBe('0.53')
    expect(ctx.systemService._store.strengthStdDev_C50).toBe('6.0')
  })

  // ========== v10.7.7+：清空单点覆盖值让它走默认/派生 ==========

  test('6. update_jgj55_param: 传 null = 清空（v10.7.7 老板场景）', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    // 模拟老板 DB 里有历史脏数据
    ctx.systemService._store.superplasticizerDosage_C40 = '2.9'
    const result = await skill.execute({ name: 'superplasticizerDosage_C40', value: null }, ctx)
    expect(result.success).toBe(true)
    expect(result.param.cleared).toBe(true)
    expect(result.param.value).toBe(null)
    // 验证 DB 里这一行被删了
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBeUndefined()
  })

  test('6b. update_jgj55_param: 传空串 = 清空', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    ctx.systemService._store.superplasticizerDosage_C40 = '2.9'
    const result = await skill.execute({ name: 'superplasticizerDosage_C40', value: '' }, ctx)
    expect(result.success).toBe(true)
    expect(result.param.cleared).toBe(true)
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBeUndefined()
  })

  test('6c. update_jgj55_param: 不传 value 也 = 清空（v10.7.7 场景）', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    ctx.systemService._store.superplasticizerDosage_C40 = '2.9'
    const result = await skill.execute({ name: 'superplasticizerDosage_C40' }, ctx)
    expect(result.success).toBe(true)
    expect(result.param.cleared).toBe(true)
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBeUndefined()
  })

  test('6d. update_jgj55_param: 清空后再调普通数字仍然 ok', async () => {
    const skill = skillByName.update_jgj55_param
    const ctx = makeContext()
    // 先清空
    ctx.systemService._store.superplasticizerDosage_C40 = '2.9'
    await skill.execute({ name: 'superplasticizerDosage_C40', value: null }, ctx)
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBeUndefined()
    // 再设回正常值
    const result = await skill.execute({ name: 'superplasticizerDosage_C40', value: 2.2 }, ctx)
    expect(result.success).toBe(true)
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBe('2.2')
  })

  test('7. clear_jgj55_param: 新增的清单个参数 skill', async () => {
    const skill = skillByName.clear_jgj55_param
    const ctx = makeContext()
    ctx.systemService._store.superplasticizerDosage_C40 = '2.9'
    const result = await skill.execute({ name: 'superplasticizerDosage_C40' }, ctx)
    expect(result.success).toBe(true)
    expect(result.param.cleared).toBe(true)
    expect(result.param.existed).toBe(true)
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBeUndefined()
  })

  test('7b. clear_jgj55_param: 清不存在的参数也成功（幂等）', async () => {
    const skill = skillByName.clear_jgj55_param
    const ctx = makeContext()
    // 先确保 mock 里没这个 key（makeContext 默认初始了 2.0）
    delete ctx.systemService._store.superplasticizerDosage_C40
    const result = await skill.execute({ name: 'superplasticizerDosage_C40' }, ctx)
    expect(result.success).toBe(true)
    expect(result.param.existed).toBe(false)
  })

  test('7c. clear_jgj55_param: 非法参数名（INVALID_NAME）', async () => {
    const skill = skillByName.clear_jgj55_param
    const ctx = makeContext()
    const result = await skill.execute({ name: 'nonExistent' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('INVALID_NAME')
  })

  test('8. batch_update_jgj55_params: 传空串 = 清空该项（修复 v10.7.7 报错 3）', async () => {
    const skill = skillByName.batch_update_jgj55_params
    const ctx = makeContext()
    ctx.systemService._store.superplasticizerDosage_C40 = '2.9'
    const result = await skill.execute(
      { updates: [{ name: 'superplasticizerDosage_C40', value: '' }] },
      ctx
    )
    expect(result.success).toBe(true)
    expect(result.updated).toHaveLength(1)
    expect(ctx.systemService._store.superplasticizerDosage_C40).toBeUndefined()
  })
})