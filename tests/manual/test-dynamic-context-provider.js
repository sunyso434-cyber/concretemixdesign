/**
 * DynamicContextProvider 测试脚本
 * 运行：node tests/manual/test-dynamic-context-provider.js
 */

const DynamicContextProvider = require('../../src/main/agent/DynamicContextProvider')

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.error(`  ✗ ${message}`)
    failed++
  }
}

// Mock services
const mockServices = {
  materialService: { getMaterials: () => Promise.resolve([]) },
  mixDesignService: { calculate: () => Promise.resolve({}) },
  basicMixDesignService: { getBasic: () => Promise.resolve({}) },
  mixDesignOptimizer: { optimize: () => Promise.resolve({}) },
  complianceService: { check: () => Promise.resolve({}) },
  knowledgeService: { search: () => Promise.resolve([]) },
  salesQuoteCalculation: { calculate: () => Promise.resolve({}) },
  salesQuoteHistory: { getHistory: () => Promise.resolve([]) },
  xgboostPrediction: { predict: () => Promise.resolve({}) },
  mixDesignToQuote: { convert: () => Promise.resolve({}) }
}

console.log('\n=== 测试getForSkill方法 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  // 模拟registry
  provider.setRegistry({
    getSkill: (name) => {
      if (name === 'test_skill') {
        return { name: 'test_skill', services: ['materialService', 'mixDesignService'] }
      }
      return null
    }
  })

  const context = provider.getForSkill('test_skill')

  assert(context.materialService !== undefined, '应该注入materialService')
  assert(context.mixDesignService !== undefined, '应该注入mixDesignService')
  assert(context.complianceService === undefined, '不应该注入complianceService')
  assert(context.knowledgeService === undefined, '不应该注入knowledgeService')
}

console.log('\n=== 测试getForSkill无services时注入全部服务 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  // 模拟registry（JS技能没有services字段）
  provider.setRegistry({
    getSkill: (name) => {
      if (name === 'js_skill') {
        return { name: 'js_skill' }  // 没有services字段
      }
      return null
    }
  })

  const context = provider.getForSkill('js_skill')

  assert(context.materialService !== undefined, 'JS技能应该注入materialService')
  assert(context.mixDesignService !== undefined, 'JS技能应该注入mixDesignService')
  assert(context.complianceService !== undefined, 'JS技能应该注入complianceService')
  assert(context.knowledgeService !== undefined, 'JS技能应该注入knowledgeService')
}

console.log('\n=== 测试getForSkill技能不存在时注入全部服务 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  // 模拟registry
  provider.setRegistry({
    getSkill: () => null
  })

  const context = provider.getForSkill('unknown_skill')

  assert(context.materialService !== undefined, '未知技能应该注入materialService')
  assert(context.mixDesignService !== undefined, '未知技能应该注入mixDesignService')
}

console.log('\n=== 测试根据services字段注入服务 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['materialService', 'mixDesignService']
  }

  const context = provider.getServices(skill)

  assert(context.materialService !== undefined, '应该注入materialService')
  assert(context.mixDesignService !== undefined, '应该注入mixDesignService')
  assert(context.complianceService === undefined, '不应该注入complianceService')
  assert(context.knowledgeService === undefined, '不应该注入knowledgeService')
}

console.log('\n=== 测试支持服务类别 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['query']
  }

  const context = provider.getServices(skill)

  assert(context.materialService !== undefined, 'query类别应该包含materialService')
  assert(context.knowledgeService !== undefined, 'query类别应该包含knowledgeService')
  assert(context.mixDesignService === undefined, 'query类别不应该包含mixDesignService')
}

console.log('\n=== 测试始终包含logger和工具方法 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: []
  }

  const context = provider.getServices(skill)

  assert(context.logger !== undefined, '应该包含logger')
  assert(typeof context.logger.info === 'function', 'logger应该有info方法')
  assert(typeof context.logger.warn === 'function', 'logger应该有warn方法')
  assert(typeof context.logger.error === 'function', 'logger应该有error方法')
  assert(typeof context.logger.debug === 'function', 'logger应该有debug方法')
  assert(typeof context.findMaterialById === 'function', '应该包含findMaterialById')
  assert(typeof context.findMaterialsByIds === 'function', '应该包含findMaterialsByIds')
}

console.log('\n=== 测试处理未知的服务名称 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['unknownService']
  }

  const context = provider.getServices(skill)

  assert(context.unknownService === undefined, '不应该注入未知服务')
}

console.log('\n=== 测试calculate类别 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['calculate']
  }

  const context = provider.getServices(skill)

  assert(context.materialService !== undefined, 'calculate类别应该包含materialService')
  assert(context.mixDesignService !== undefined, 'calculate类别应该包含mixDesignService')
  assert(context.basicMixDesignService !== undefined, 'calculate类别应该包含basicMixDesignService')
  assert(context.mixDesignOptimizer === undefined, 'calculate类别不应该包含mixDesignOptimizer')
}

console.log('\n=== 测试optimize类别 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['optimize']
  }

  const context = provider.getServices(skill)

  assert(context.materialService !== undefined, 'optimize类别应该包含materialService')
  assert(context.mixDesignService !== undefined, 'optimize类别应该包含mixDesignService')
  assert(context.mixDesignOptimizer !== undefined, 'optimize类别应该包含mixDesignOptimizer')
}

console.log('\n=== 测试check类别 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['check']
  }

  const context = provider.getServices(skill)

  assert(context.materialService !== undefined, 'check类别应该包含materialService')
  assert(context.complianceService !== undefined, 'check类别应该包含complianceService')
  assert(context.knowledgeService !== undefined, 'check类别应该包含knowledgeService')
  assert(context.mixDesignService === undefined, 'check类别不应该包含mixDesignService')
}

console.log('\n=== 测试sales类别 ===')
{
  const provider = new DynamicContextProvider(mockServices)

  const skill = {
    name: 'test_skill',
    services: ['sales']
  }

  const context = provider.getServices(skill)

  assert(context.materialService !== undefined, 'sales类别应该包含materialService')
  assert(context.salesQuoteCalculation !== undefined, 'sales类别应该包含salesQuoteCalculation')
  assert(context.salesQuoteHistory !== undefined, 'sales类别应该包含salesQuoteHistory')
  assert(context.mixDesignService === undefined, 'sales类别不应该包含mixDesignService')
}

console.log(`\n=== 测试结果 ===`)
console.log(`通过: ${passed}, 失败: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
