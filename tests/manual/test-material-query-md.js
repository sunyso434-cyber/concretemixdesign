/**
 * material-query MD技能验证测试
 * 运行：node tests/manual/test-material-query-md.js
 */

const path = require('path')
const fs = require('fs')
const SkillRegistry = require('../../src/main/agent/SkillRegistry')
const AgentOrchestrator = require('../../src/main/agent/AgentOrchestrator')

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

async function runTests() {
  console.log('\n=== 测试加载material-query MD技能 ===')
  {
    const registry = new SkillRegistry()
    registry._userDir = path.join(require('os').homedir(), '.concrete-mixdesign', 'skills')
    await registry.discover()

    const skill = registry.getSkill('material_query')
    assert(skill !== null, '应该加载material_query技能')
    assert(skill.name === 'material_query', 'name应该正确')
    assert(skill.description === '查询材料信息，根据材料类型和规格筛选材料列表', 'description应该正确')
    assert(skill._isMDSkill === true, '应该标记为MD技能')
    assert(skill._mdBody.includes('# 查询材料信息'), '_mdBody应该包含正文')
    assert(skill._mdBody.includes('{{material_type}}'), '_mdBody应该包含占位符')
  }

  console.log('\n=== 测试生成正确的tool schema ===')
  {
    const registry = new SkillRegistry()
    registry._userDir = path.join(require('os').homedir(), '.concrete-mixdesign', 'skills')
    await registry.discover()

    const schemas = registry.getToolSchemas()
    const schema = schemas.find(s => s.function.name === 'material_query')

    assert(schema !== undefined, '应该生成tool schema')
    assert(schema.function.description === '查询材料信息，根据材料类型和规格筛选材料列表', 'schema描述应该正确')
    assert(schema.function.parameters.required.includes('material_type'), 'material_type应该是必填')
    assert(!schema.function.parameters.required.includes('specification'), 'specification不应该是必填')
    assert(schema.function.parameters.properties.material_type.type === 'string', 'material_type类型应该是string')
    assert(schema.function.parameters.properties.material_type.description === '材料类型，如水泥、钢筋、砂、石', 'material_type描述应该正确')
  }

  console.log('\n=== 测试_buildMDInstruction参数替换 ===')
  {
    const registry = new SkillRegistry()
    registry._userDir = path.join(require('os').homedir(), '.concrete-mixdesign', 'skills')
    await registry.discover()

    const skill = registry.getSkill('material_query')

    // Mock DeepSeekService
    const mockDs = { chatWithTools: async () => null }
    const mockExecutor = { execute: async () => ({}) }

    const orchestrator = new AgentOrchestrator({
      deepseekService: mockDs,
      skillRegistry: registry,
      skillExecutor: mockExecutor
    })

    const instruction = orchestrator._buildMDInstruction(skill, { material_type: '水泥', specification: '42.5' })

    assert(instruction.includes('material_type 为 "水泥"'), '应该替换material_type参数')
    assert(instruction.includes('specification="42.5"'), '应该替换specification参数')
    assert(!instruction.includes('{{material_type}}'), '不应该还有未替换的占位符')
    assert(!instruction.includes('{{specification}}'), '不应该还有未替换的占位符')
    assert(instruction.includes('用户自定义技能'), '应该包含技能名称')
  }

  console.log(`\n=== 测试结果 ===`)
  console.log(`通过: ${passed}, 失败: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(error => {
  console.error('测试执行失败:', error)
  process.exit(1)
})
