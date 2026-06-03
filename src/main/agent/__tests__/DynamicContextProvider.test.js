/**
 * DynamicContextProvider 单测
 *
 * F2.3 任务：验证技能 services 声明 → 按声明注入；未声明 → 兼容模式（全量注入）。
 *
 * 关键点（与 plan 不同的实际 API）：
 * - 构造函数接 allServices 对象（plan 假设对的，但用 getServices(skill) 入口）
 * - getForSkill(skillName) 只接字符串，技能从 registry 查
 * - getServices(skill) 接技能对象，是"按 services 声明注入"的真正入口
 * - 当前未声明 services → 返回全量（兼容 JS 技能），不 throw
 *   （D 阶段才改成 throw；本次测试按当前实际行为）
 */

const DynamicContextProvider = require('../DynamicContextProvider')

describe('DynamicContextProvider', () => {
  test('技能声明 services 时应只注入声明的', () => {
    const services = {
      materialService: { name: 'mat' },
      costService: { name: 'cost' }
    }
    const provider = new DynamicContextProvider(services)
    const skill = { name: 's1', services: ['materialService'] }
    const ctx = provider.getServices(skill)

    // 声明的应该注入
    expect(ctx.materialService).toBe(services.materialService)
    // 未声明的不应该注入
    expect(ctx.costService).toBeUndefined()
    // 工具方法仍应注入
    expect(ctx.logger).toBeDefined()
    expect(typeof ctx.findMaterialById).toBe('function')
    expect(typeof ctx.findMaterialsByIds).toBe('function')
  })

  test('技能未声明 services 时（D 阶段前）应返回全量服务（兼容模式）', () => {
    const services = {
      materialService: { name: 'mat' },
      costService: { name: 'cost' }
    }
    const provider = new DynamicContextProvider(services)
    // 没 services 字段
    const skill = { name: 'undeclared' }
    const ctx = provider.getServices(skill)

    // 兼容模式：所有服务都注入
    expect(ctx.materialService).toBe(services.materialService)
    expect(ctx.costService).toBe(services.costService)
    // 工具方法也在
    expect(ctx.logger).toBeDefined()
    expect(typeof ctx.findMaterialById).toBe('function')
  })
})
