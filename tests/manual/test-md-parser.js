/**
 * MDParser 测试脚本
 * 运行：node tests/manual/test-md-parser.js
 */

const path = require('path')
const fs = require('fs')
const MDParser = require('../../src/main/agent/MDParser')

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

function assertThrows(fn, expectedMessage, testName) {
  try {
    fn()
    console.error(`  ✗ ${testName} - 应该抛出错误但没有`)
    failed++
  } catch (error) {
    if (error.message.includes(expectedMessage)) {
      console.log(`  ✓ ${testName}`)
      passed++
    } else {
      console.error(`  ✗ ${testName} - 错误消息不匹配: ${error.message}`)
      failed++
    }
  }
}

// 创建测试目录
const testDir = path.join(__dirname, '__fixtures__')
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true })
}

const parser = new MDParser()

console.log('\n=== 测试从YAML front matter解析parameters ===')
{
  const mdContent = `---
name: query_material_strength
description: 查询材料强度
category: query
parameters:
  material_type:
    type: string
    description: 材料类型，如水泥、钢筋
    required: true
  specification:
    type: string
    description: 材料规格，如42.5
    required: false
---

# 查询材料强度

## 功能描述
根据材料类型和规格查询对应的强度等级。

## 执行步骤

1. 使用 list_available_materials 工具查询材料列表
2. 根据 material_type="{{material_type}}" 和 specification="{{specification}}" 筛选
3. 返回筛选结果的强度信息
`
  const filePath = path.join(testDir, 'test.md')
  fs.writeFileSync(filePath, mdContent)

  const result = parser.parse(filePath)

  assert(result.name === 'query_material_strength', 'name应该正确解析')
  assert(result.description === '查询材料强度', 'description应该正确解析')
  assert(result.parameters !== undefined, 'parameters应该存在')
  assert(result.parameters.material_type !== undefined, 'material_type参数应该存在')
  assert(result.parameters.material_type.type === 'string', 'material_type类型应该是string')
  assert(result.parameters.material_type.required === true, 'material_type应该是必填')
  assert(result.parameters.specification !== undefined, 'specification参数应该存在')
  assert(result.parameters.specification.required === false, 'specification应该是可选')
}

console.log('\n=== 测试提取正文内容（不含front matter） ===')
{
  const mdContent = `---
name: test_skill
description: 测试技能
---

# 测试技能

## 功能描述
这是功能描述

## 执行步骤
1. 步骤一
2. 步骤二
`
  const filePath = path.join(testDir, 'test-body.md')
  fs.writeFileSync(filePath, mdContent)

  const result = parser.parse(filePath)

  assert(result.body.includes('# 测试技能'), '正文应该包含标题')
  assert(result.body.includes('## 功能描述'), '正文应该包含功能描述')
  assert(!result.body.includes('---'), '正文不应该包含front matter分隔符')
}

console.log('\n=== 测试识别{{param_name}}占位符 ===')
{
  const mdContent = `---
name: test_skill
description: 测试技能
parameters:
  material_type:
    type: string
    required: true
---

# 测试技能

查询 {{material_type}} 的信息
`
  const filePath = path.join(testDir, 'test-placeholder.md')
  fs.writeFileSync(filePath, mdContent)

  const result = parser.parse(filePath)

  assert(result.placeholders.includes('material_type'), '应该识别material_type占位符')
}

console.log('\n=== 测试验证必填字段 ===')
{
  const mdContent = `---
description: 缺少name的技能
---

# 测试
`
  const filePath = path.join(testDir, 'invalid.md')
  fs.writeFileSync(filePath, mdContent)

  assertThrows(
    () => parser.parse(filePath),
    '缺少name字段',
    '应该验证name字段必填'
  )
}

console.log('\n=== 测试验证name格式 ===')
{
  const mdContent = `---
name: Invalid Name!
description: 测试技能
---

# 测试
`
  const filePath = path.join(testDir, 'invalid-name.md')
  fs.writeFileSync(filePath, mdContent)

  assertThrows(
    () => parser.parse(filePath),
    'name只能包含小写字母、数字和下划线',
    '应该验证name格式'
  )
}

// 清理测试目录
fs.rmSync(testDir, { recursive: true, force: true })

console.log(`\n=== 测试结果 ===`)
console.log(`通过: ${passed}, 失败: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
