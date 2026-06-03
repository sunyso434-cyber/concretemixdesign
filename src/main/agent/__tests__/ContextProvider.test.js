/**
 * ContextProvider 单测
 *
 * F2.2 任务：验证 getForSkill 注入服务和工具到 context。
 *
 * 关键点（与 plan 不同的实际 API）：
 * - 构造函数无参（plan 假设接 services 注入）
 * - 服务是静态类引用（require 进来），不通过构造注入
 * - 内部字段名是 _services
 * - getForSkill(skillName) 单参，返回的 ctx 含服务 + logger + 工具方法
 */

// 必须在 require ContextProvider 之前 mock electron
// ContextProvider 间接 require StandardKnowledgeService，后者顶层调 app.getPath('userData')
jest.mock('electron', () => ({
  app: {
    getPath: (name) => {
      if (name === 'userData') return require('os').tmpdir()
      return require('os').tmpdir()
    }
  }
}))

const ContextProvider = require('../ContextProvider')

describe('ContextProvider', () => {
  test('getForSkill 应注入所有服务到 context', () => {
    const provider = new ContextProvider()
    const ctx = provider.getForSkill('any_skill')

    // 服务：核心业务模块都应可用
    expect(ctx.materialService).toBeDefined()
    expect(ctx.mixDesignService).toBeDefined()
    expect(ctx.basicMixDesignService).toBeDefined()
    expect(ctx.mixDesignOptimizer).toBeDefined()
    expect(ctx.complianceService).toBeDefined()
    expect(ctx.knowledgeService).toBeDefined()
    expect(ctx.salesQuoteCalculation).toBeDefined()
    expect(ctx.salesQuoteHistory).toBeDefined()
    expect(ctx.xgboostPrediction).toBeDefined()
    expect(ctx.mixDesignToQuote).toBeDefined()
  })

  test('getForSkill 应提供带 skillName 的 logger', () => {
    const provider = new ContextProvider()
    const ctx = provider.getForSkill('my_skill')

    expect(ctx.logger).toBeDefined()
    expect(typeof ctx.logger.info).toBe('function')
    expect(typeof ctx.logger.warn).toBe('function')
    expect(typeof ctx.logger.error).toBe('function')
    expect(typeof ctx.logger.debug).toBe('function')
  })

  test('getForSkill 应提供 findMaterial 工具方法', () => {
    const provider = new ContextProvider()
    const ctx = provider.getForSkill('any_skill')

    expect(typeof ctx.findMaterialById).toBe('function')
    expect(typeof ctx.findMaterialsByIds).toBe('function')
  })

  test('logger.info 输出应带 [Skill:skillName] 前缀', () => {
    const provider = new ContextProvider()
    const ctx = provider.getForSkill('test_skill')

    // spy console.log 验证前缀
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    ctx.logger.info('hello')
    expect(spy).toHaveBeenCalled()
    const firstArg = spy.mock.calls[0][0]
    expect(firstArg).toContain('test_skill')
    spy.mockRestore()
  })
})
