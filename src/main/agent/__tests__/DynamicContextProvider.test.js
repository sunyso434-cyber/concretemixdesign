/**
 * DynamicContextProvider 单测
 *
 * F2.3 任务：验证技能 services 声明 → 按声明注入；未声明 → 应 throw。
 *
 * 关键点（与 plan 不同的实际 API）：
 * - 构造函数接 allServices 对象（plan 假设对的，但用 getServices(skill) 入口）
 * - getForSkill(skillName) 只接字符串，技能从 registry 查
 * - getServices(skill) 接技能对象，是"按 services 声明注入"的真正入口
 * - G3.2：未声明 services 字段 → 抛 services_undeclared 错误（避免静默全量注入）
 * - 显式空数组 [] 允许（系统 skill 无依赖服务时）
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

  test('技能未声明 services 时应抛 services_undeclared 错误', () => {
    const services = {
      materialService: { name: 'mat' },
      costService: { name: 'cost' }
    }
    const provider = new DynamicContextProvider(services)
    // 没 services 字段 → 应 throw
    const skill = { name: 'undeclared' }

    expect(() => provider.getServices(skill)).toThrow(/services_undeclared/)
    expect(() => provider.getServices(skill)).toThrow(/undeclared/)
  })

  test('技能显式声明空数组 services: [] 时应正常返回（无业务服务）', () => {
    const services = {
      materialService: { name: 'mat' },
      costService: { name: 'cost' }
    }
    const provider = new DynamicContextProvider(services)
    // 显式空数组 → 允许（系统 skill 无依赖服务）
    const skill = { name: 'system-skill', services: [] }
    const ctx = provider.getServices(skill)

    // 业务服务一个都不注入
    expect(ctx.materialService).toBeUndefined()
    expect(ctx.costService).toBeUndefined()
    // 工具方法仍注入
    expect(ctx.logger).toBeDefined()
    expect(typeof ctx.findMaterialById).toBe('function')
  })
})
