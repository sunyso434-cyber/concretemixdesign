// 2026-08-23 修复：optimizeMixDesign 入口前置校验
// 此前未选砂/石时在阶段 1/3 深处抛 "Cannot read properties of null" TypeError
const optimizer = require('../MixDesignOptimizer')

// 有材料的基准入参（校验在阶段 1 之前抛出，选水泥/砂/石后才会进入真实计算——
// 本测试只测校验分支，传入的材料对象为空壳，不触发 DB / 真实计算）
function makeParams(materials) {
  return { constraints: { strength: 'C30', slump: 180, materials } }
}

describe('optimizeMixDesign 入口材料校验', () => {
  test('未选砂 → 抛出含"砂"的中文可读错误（而非 TypeError）', async () => {
    await expect(optimizer.optimizeMixDesign(makeParams({
      cement: [{}], sand: [], stone: [{}]
    }))).rejects.toThrow(/砂/)
  })

  test('未选石 → 抛出含"石"的中文可读错误', async () => {
    await expect(optimizer.optimizeMixDesign(makeParams({
      cement: [{}], sand: [{}], stone: []
    }))).rejects.toThrow(/石/)
  })

  test('未选水泥 → 抛出含"水泥"的中文可读错误', async () => {
    await expect(optimizer.optimizeMixDesign(makeParams({
      cement: [], sand: [{}], stone: [{}]
    }))).rejects.toThrow(/水泥/)
  })

  test('materials 整体缺失 → 同样给出可读错误', async () => {
    await expect(optimizer.optimizeMixDesign({ constraints: {} })).rejects.toThrow(/水泥/)
  })

  test('单对象（非数组）材料也能识别为已选', async () => {
    // 单材料以对象而非数组传入：校验应放行（后续阶段按单材料处理）
    // 放行后会进入阶段 1 真实逻辑，此处用空壳对象让 _preselectStone 返回 undefined、
    // 阶段 2 之前不再有材料校验外的必抛点——用 rejects/spy 均不稳定，改为仅断言不抛校验错误
    const err = await optimizer.optimizeMixDesign(makeParams({
      cement: { id: 'c' }, sand: { id: 's' }, stone: { id: 'st' }
    })).catch(e => e)
    expect(String(err && err.message)).not.toMatch(/请先选择/)
  })
})
