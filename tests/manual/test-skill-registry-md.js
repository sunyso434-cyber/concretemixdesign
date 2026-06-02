/**
 * SkillRegistry MD支持测试脚本
 * 运行：node tests/manual/test-skill-registry-md.js
 */

const path = require('path')
const fs = require('fs')
const SkillRegistry = require('../../src/main/agent/SkillRegistry')

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

// 创建测试目录
const testDir = path.join(__dirname, '__fixtures__')
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true })
}

console.log('\n=== 测试加载MD格式的技能文件 ===')
{
  const mdContent = `---
name: test_md_skill
description: 测试MD技能
category: query
parameters:
  material_type:
    type: string
    description: 材料类型
    required: true
---

# 测试MD技能

## 功能描述
这是一个测试技能

## 执行步骤

1. 使用 list_available_materials 工具查询材料列表
2. 根据 material_type="{{material_type}}" 筛选
`
  const filePath = path.join(testDir, 'test_md_skill.md')
  fs.writeFileSync(filePath, mdContent)

  const registry = new SkillRegistry()
  registry._userDir = testDir
  registry._loadFromDir(testDir, { builtin: false })

  const skill = registry.getSkill('test_md_skill')
  assert(skill !== null, '应该加载MD技能')
  assert(skill.name === 'test_md_skill', 'name应该正确')
  assert(skill.description === '测试MD技能', 'description应该正确')
  assert(skill._isMDSkill === true, '应该标记为MD技能')
  assert(skill._mdBody.includes('# 测试MD技能'), '_mdBody应该包含正文')
}

console.log('\n=== 测试MD技能应该生成正确的tool schema ===')
{
  const mdContent = `---
name: test_schema
description: 测试schema生成
parameters:
  material_type:
    type: string
    description: 材料类型
    required: true
  specification:
    type: string
    description: 材料规格
    required: false
---

# 测试
`
  const filePath = path.join(testDir, 'test_schema.md')
  fs.writeFileSync(filePath, mdContent)

  const registry = new SkillRegistry()
  registry._userDir = testDir
  registry._loadFromDir(testDir, { builtin: false })

  const schemas = registry.getToolSchemas()
  const schema = schemas.find(s => s.function.name === 'test_schema')

  assert(schema !== undefined, '应该生成tool schema')
  assert(schema.function.parameters.required.includes('material_type'), 'material_type应该是必填')
  assert(!schema.function.parameters.required.includes('specification'), 'specification不应该是必填')
  assert(schema.function.parameters.properties.material_type.type === 'string', 'material_type类型应该是string')
}

console.log('\n=== 测试应该同时支持JS和MD格式 ===')
{
  // JS格式
  const jsContent = `
module.exports = {
  name: 'test_js_skill',
  description: '测试JS技能',
  parameters: {},
  async execute(args, context) {
    return { success: true }
  }
}
`
  const jsPath = path.join(testDir, 'test_js_skill.js')
  fs.writeFileSync(jsPath, jsContent)

  // MD格式
  const mdContent = `---
name: test_md_skill2
description: 测试MD技能2
parameters: {}
---

# 测试
`
  const mdPath = path.join(testDir, 'test_md_skill2.md')
  fs.writeFileSync(mdPath, mdContent)

  const registry = new SkillRegistry()
  registry._userDir = testDir
  registry._loadFromDir(testDir, { builtin: false })

  assert(registry.getSkill('test_js_skill') !== null, '应该加载JS技能')
  assert(registry.getSkill('test_md_skill2') !== null, '应该加载MD技能')
}

// 清理测试目录
fs.rmSync(testDir, { recursive: true, force: true })

console.log(`\n=== 测试结果 ===`)
console.log(`通过: ${passed}, 失败: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
